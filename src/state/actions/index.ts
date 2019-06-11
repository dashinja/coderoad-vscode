import { assign } from 'xstate'
// NOTE: codesmell - importing machine
import { machine } from '../../extension'
import api from '../../services/api'
import * as CR from 'typings'
import * as vscode from 'vscode'
import * as storage from '../../services/storage'
import * as git from '../../services/git'

let currentTutorial: CR.Tutorial | undefined
let currentProgress: CR.Progress = {
    levels: {},
    stages: {},
    steps: {},
    complete: false,
}

export default {
    createWebview() {
        console.log('execute coderoad.open_webview')
        vscode.commands.executeCommand('coderoad.open_webview')
    },
    async newOrContinue() {
        // verify that the user has a tutorial & progress
        // verify git is setup with a coderoad remote
        const [tutorial, progress, hasGit, hasGitRemote] = await Promise.all([
            storage.getTutorial(),
            storage.getProgress(),
            git.gitVersion(),
            git.gitCheckRemoteExists(),
        ])
        const canContinue = !!(tutorial && progress && hasGit && hasGitRemote)

        if (canContinue) {
            currentTutorial = tutorial
            currentProgress = progress
        }

        machine.send(canContinue ? 'CONTINUE' : 'NEW')
    },
    async tutorialLaunch() {
        // TODO: add selection of tutorial id
        const tutorial: CR.Tutorial = await api({ resource: 'getTutorial', params: { id: '1' } })
        console.log('api')
        console.log(tutorial)
        vscode.commands.executeCommand('coderoad.tutorial_launch', tutorial)
    },
    tutorialSetup() {
        vscode.commands.executeCommand('coderoad.tutorial_setup', currentTutorial)
    },
    tutorialContinue: assign({
        // load initial data, progress & position
        data(): CR.TutorialData {
            console.log('ACTION: tutorialLoad.data')
            if (!currentTutorial) {
                throw new Error('No Tutorial loaded')
            }
            return currentTutorial.data

        },
        progress(): CR.Progress {
            console.log('ACTION: tutorialLoad.progress')
            return currentProgress
        },
        position() {
            console.log('ACTION: tutorialLoad.position')
            if (!currentTutorial) {
                throw new Error('No Tutorial loaded')
            }
            const { data } = currentTutorial

            const levelId = data.summary.levelList[0]
            const stageId = data.levels[levelId].stageList[0]
            const stepId = data.stages[stageId].stepList[0]

            const position = {
                levelId,
                stageId,
                stepId,
            }

            return position
        }
    }),
    tutorialLoadNext() {
        machine.send('LOAD_NEXT')
    }
}