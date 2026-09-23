import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildStartupCommandSubmission } from '../../../shared/startup-command-submission'
import { buildObservedSetupCommand, createSetupCompletionScanner } from './setup-completion-signal'

const POSIX_SHELLS = ['bash', 'zsh'].filter(
  (shell) => process.platform !== 'win32' && spawnSync(shell, ['-c', 'exit 0']).status === 0
)

function observedScript(observed: { env?: Record<string, string> }): string {
  return observed.env?.ORCA_SETUP_OBSERVED_SCRIPT ?? ''
}

// Keystroke model of hlissner/zsh-autopair, the line-editor plugin that corrupted #18059: the
// buffer the user's zle holds once Orca has typed `keystrokes` into it (up to accept-line).
const AUTOPAIR_PAIRS: Record<string, string> = {
  '`': '`',
  "'": "'",
  '"': '"',
  '{': '}',
  '[': ']',
  '(': ')',
  ' ': ' '
}
const AUTOPAIR_OPENERS: Record<string, string> = { '}': '{', ']': '[', ')': '(' }
const AUTOPAIR_LEFT_BOUNDS: Record<string, RegExp> = {
  all: /[.:/\\!]$/,
  quotes: /[\]})a-zA-Z0-9]$/,
  spaces: /[^{([]$/,
  '`': /`$/,
  '"': /"$/,
  "'": /'$/
}
const AUTOPAIR_RIGHT_BOUNDS: Record<string, RegExp> = {
  all: /^[[{(<,.:?/%$!a-zA-Z0-9]/,
  quotes: /^[a-zA-Z0-9]/,
  spaces: /^[^\]})]/
}

function typeThroughZshAutopair(keystrokes: string): string {
  let left = ''
  let right = ''
  const count = (text: string, char: string): number => text.split(char).length - 1
  const balanced = (open: string, close: string): boolean => {
    const l = left.replaceAll(`\\${open}`, '')
    const r = right.replaceAll(`\\${close}`, '')
    const lCount = count(l, open)
    const rCount = count(r, close)
    if (lCount === 0 && rCount === 0) {
      return true
    }
    if (open === ' ') {
      const match = /[^'"]([ \t]+)$/.exec(left)
      return Boolean(match && right.startsWith(match[1]))
    }
    if (open === close) {
      return lCount === rCount || (lCount + rCount) % 2 === 0
    }
    return Math.max(0, lCount - count(l, close)) >= rCount - count(r, open)
  }
  const nextToBoundary = (key: string): boolean => {
    const group = `'"\``.includes(key) ? 'quotes' : key === ' ' ? 'spaces' : 'braces'
    return ['all', group, key].some(
      (name) =>
        Boolean(AUTOPAIR_LEFT_BOUNDS[name]?.test(left)) ||
        Boolean(AUTOPAIR_RIGHT_BOUNDS[name]?.test(right))
    )
  }
  const canPair = (key: string): boolean => {
    const close = AUTOPAIR_PAIRS[key]
    if (close !== ' ' ? !balanced(key, close) : /^[ \t]*$/.test(right)) {
      return false
    }
    return !nextToBoundary(key)
  }
  const canSkip = (open: string, close: string): boolean => {
    if (!left || (open === close && (open === ' ' || !balanced(open, close)))) {
      return false
    }
    return right[0] === close && !left.endsWith('\\')
  }
  for (const key of keystrokes) {
    if (key === '\n' || key === '\r') {
      break
    }
    const close = AUTOPAIR_PAIRS[key]
    const opener = AUTOPAIR_OPENERS[key]
    if (close && `'"\` `.includes(key) && canSkip(key, close)) {
      left += right[0]
      right = right.slice(1)
    } else if (close && canPair(key)) {
      left += key
      right = close + right
    } else if (opener && canSkip(opener, key)) {
      left += right[0]
      right = right.slice(1)
    } else {
      left += key
    }
  }
  return left + right
}

describe('orchestration setup completion signal', () => {
  let scratchDir: string | undefined

  afterEach(() => {
    if (scratchDir) {
      rmSync(scratchDir, { recursive: true, force: true })
      scratchDir = undefined
    }
  })

  it('preserves a POSIX setup exit code in a visible completion signal', () => {
    const observed = buildObservedSetupCommand(
      '/repo/.git/orca/setup-runner.sh',
      'posix',
      'token-posix'
    )
    const script = observedScript(observed)

    expect(observed.command).toBe(`bash -lc 'eval "$ORCA_SETUP_OBSERVED_SCRIPT"'`)
    expect(script).toContain('bash /repo/.git/orca/setup-runner.sh')
    expect(script).toContain('__ORCA_SETUP_COMPLETE__:token-posix:%s\\n')
    expect(script).toContain('"$status"')
    expect(script).toContain('exit "$status"')
  })

  it('types a POSIX command that a pair-inserting line editor leaves intact', () => {
    // Regression (#18059): zsh-autopair turned `( ` into `(  )`, handing bash `...; exit "$status" )`.
    const { command } = buildObservedSetupCommand(
      '/repo/.git/orca/setup-runner.sh',
      'posix',
      'token-autopair'
    )

    expect(typeThroughZshAutopair(command)).toBe(command)
    // Anchors the model to the reported corruption of the old inline-subshell form.
    expect(typeThroughZshAutopair(`bash -lc '( bash r ); exit "$status"'`)).toBe(
      `bash -lc '( bash r ); exit "$status"'' )'`
    )
  })

  describe.each(POSIX_SHELLS)('delivered to %s through a pair-inserting line editor', (shell) => {
    it.each([0, 3])('runs the runner once and reports its exit code %i', (exitCode) => {
      scratchDir = mkdtempSync(join(tmpdir(), 'orca-observed-setup-'))
      const runnerPath = join(scratchDir, 'setup-runner.sh')
      writeFileSync(runnerPath, `printf 'SETUP_OK\\n'\nexit ${exitCode}\n`)
      const observed = buildObservedSetupCommand(runnerPath, 'posix', 'token-exec')
      const submitted = buildStartupCommandSubmission(observed.command, {
        submit: '\n',
        bracketedPasteSafe: true
      })

      const result = spawnSync(shell, ['-c', typeThroughZshAutopair(submitted)], {
        env: { ...process.env, ...observed.env },
        encoding: 'utf8'
      })

      expect(result.stderr).not.toContain('syntax error')
      expect(result.stdout.match(/SETUP_OK/g)).toHaveLength(1)
      expect(result.stdout).toContain(`\n__ORCA_SETUP_COMPLETE__:token-exec:${exitCode}\n`)
      expect(result.status).toBe(exitCode)
    })
  })

  it('preserves a native Windows setup path and exit code without shell interpolation', () => {
    const runnerPath = 'C:\\repo %name%!^&\\.git\\orca\\setup-runner.cmd'
    const observed = buildObservedSetupCommand(runnerPath, 'windows', 'token-windows')
    const encodedCommand = observed.command.split(' ').at(-1)
    const script = Buffer.from(encodedCommand ?? '', 'base64').toString('utf16le')

    expect(observed.command).toContain('powershell.exe -NoLogo -NoProfile -NonInteractive')
    expect(observed.env).toEqual({ ORCA_SETUP_RUNNER_PATH: runnerPath })
    expect(script).toContain('& $runner')
    expect(script).toContain('__ORCA_SETUP_COMPLETE__:token-windows:')
    expect(script).toContain('exit $status')
    expect(script).not.toContain(runnerPath)
  })

  it('keeps a WSL runner on the POSIX completion path', () => {
    const script = observedScript(
      buildObservedSetupCommand(
        '\\\\wsl.localhost\\Ubuntu\\repo\\.git\\orca\\setup-runner.sh',
        'windows',
        'token-wsl'
      )
    )

    expect(script).toContain('bash /repo/.git/orca/setup-runner.sh')
    expect(script).toContain('__ORCA_SETUP_COMPLETE__:token-wsl:%s\\n')
    expect(script).toContain('exit "$status"')
  })

  it('routes a WSL-launched Windows-drive runner through its /mnt mount', () => {
    const script = observedScript(
      buildObservedSetupCommand('C:\\repo\\.git\\orca\\setup-runner.sh', 'windows', 'token-mnt', {
        family: 'posix',
        executable: 'wsl.exe'
      })
    )

    expect(script).toContain('bash /mnt/c/repo/.git/orca/setup-runner.sh')
    expect(script).not.toContain('bash /c/repo')
  })

  it('keeps a Git Bash runner on the MSYS drive form', () => {
    const script = observedScript(
      buildObservedSetupCommand(
        'C:\\repo\\.git\\orca\\setup-runner.sh',
        'windows',
        'token-git-bash',
        {
          family: 'posix'
        }
      )
    )

    expect(script).toContain('bash /c/repo/.git/orca/setup-runner.sh')
  })

  it('keeps a batch runner on the Windows completion path from a Git Bash pane', () => {
    // Regression (#6896): a Git Bash terminal with a batch setup script still gets a .cmd
    // runner; observing it must not shell out to bash or type a bare `cmd.exe /c` switch.
    const runnerPath = 'C:\\repo\\.git\\orca\\setup-runner.cmd'
    const observed = buildObservedSetupCommand(runnerPath, 'windows', 'token-git-bash-cmd', {
      family: 'posix'
    })

    expect(observed.command).toContain('powershell.exe -NoLogo -NoProfile -NonInteractive')
    expect(observed.command).not.toContain('bash ')
    expect(observed.env).toEqual({ ORCA_SETUP_RUNNER_PATH: runnerPath })
  })

  it('recognizes one completion signal across output chunk boundaries', () => {
    const onComplete = vi.fn()
    const scanner = createSetupCompletionScanner('token-chunks', onComplete)

    scanner.scan('installing...\r\n__ORCA_SETUP_COMPLETE__:wrong:0\r\n__ORCA_SETUP_COMP')
    scanner.scan('LETE__:token-chunks:1')
    expect(onComplete).not.toHaveBeenCalled()
    scanner.scan('7\r')
    expect(onComplete).not.toHaveBeenCalled()
    scanner.scan('\nPS C:\\repo>')
    scanner.scan('__ORCA_SETUP_COMPLETE__:token-chunks:0\r\n')

    expect(onComplete).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledWith(17)
  })
})
