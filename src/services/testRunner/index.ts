import * as T from 'typings'
import * as TT from 'typings/tutorial'
import { exec } from '../node'
import logger from '../logger'
import parser, { ParserOutput } from './parser'
import { debounce, throttle } from './throttle'
import onError from '../sentry/onError'
import { clearOutput, addOutput } from './output'
import { formatFailOutput } from './formatOutput'

interface Callbacks {
  onSuccess(position: T.Position): void
  onFail(position: T.Position, failSummary: T.TestFail): void
  onRun(position: T.Position): void
  onError(position: T.Position): void
  onLoadSubtasks({ summary }: { summary: { [testName: string]: boolean } }): void
}

const failChannelName = 'CodeRoad (Tests)'
const logChannelName = 'CodeRoad (Logs)'

interface TestRunnerParams {
  position: T.Position
  subtasks?: boolean
  onSuccess?: () => void
}

const createTestRunner = (data: TT.Tutorial, callbacks: Callbacks) => {
  const testRunnerConfig = data.config.testRunner
  const testRunnerFilterArg = testRunnerConfig.args?.filter
  return async ({ position, onSuccess, subtasks }: TestRunnerParams): Promise<void> => {
    const startTime = throttle()
    // throttle time early
    if (!startTime) {
      return
    }

    logger('------------------- RUN TEST -------------------')

    // flag as running
    if (!subtasks) {
      callbacks.onRun(position)
    }

    let result: { stdout: string | undefined; stderr: string | undefined }
    try {
      let command = testRunnerConfig.args
        ? `${testRunnerConfig.command} ${testRunnerConfig?.args.tap}`
        : testRunnerConfig.command // TODO: enforce TAP

      // filter tests if requested
      if (testRunnerFilterArg) {
        // get tutorial step from position
        // check the step actions for specific command
        // NOTE: cannot just pass in step actions as the test can be called by:
        // - onEditorSave, onWatcher, onSolution, onRunTest, onSubTask
        const levels = data.levels
        const level = levels.find((l) => l.id === position.levelId)
        const step = level?.steps.find((s) => s.id === position.stepId)
        const testFilter = step?.setup?.filter
        if (testFilter) {
          // append filter commands
          command = [command, testRunnerFilterArg, testFilter].join(' ')
        } else {
          throw new Error('Test Runner filter not configured')
        }
      }
      logger('COMMAND', command)
      result = await exec({ command, dir: testRunnerConfig.directory || testRunnerConfig.path }) // TODO: remove config.path later
    } catch (err) {
      result = { stdout: err.stdout, stderr: err.stack }
    }

    // ignore output if not latest process
    // this is a crappy version of debounce
    if (!debounce(startTime)) {
      return
    }

    logger('----------------- PROCESS TEST -----------------')

    const { stdout, stderr } = result

    const tap: ParserOutput = parser(stdout || '')

    if (subtasks) {
      callbacks.onLoadSubtasks({ summary: tap.summary })
      // exit early
      return
    }

    addOutput({ channel: logChannelName, text: tap.logs.join('\n'), show: false })

    if (stderr) {
      // FAIL also trigger stderr
      if (stdout && stdout.length && !tap.ok) {
        const firstFail = tap.failed[0]
        const failSummary = {
          title: firstFail.message || 'Test Failed',
          description: firstFail.details || 'Unknown error',
          summary: tap.summary,
        }
        callbacks.onFail(position, failSummary)
        const output = formatFailOutput(tap)
        addOutput({ channel: failChannelName, text: output, show: true })
        return
      } else {
        callbacks.onError(position)
        // open terminal with error string
        addOutput({ channel: failChannelName, text: stderr, show: true })
        return
      }
    }

    // PASS
    if (tap.ok) {
      clearOutput(failChannelName)

      callbacks.onSuccess(position)

      if (onSuccess) {
        onSuccess()
      }
    } else {
      // should never get here
      onError(new Error(`Error with running test ${JSON.stringify(position)}`))
      callbacks.onError(position)
    }
  }
}

export default createTestRunner
