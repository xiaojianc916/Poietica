import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const TARGET = path.join(ROOT, 'refactor.mjs')

async function main() {
  let source = await readFile(TARGET, 'utf8')

  source = replaceDependencyRepairBlock(source)

  source = installDependencyHelper(source)

  await writeFile(TARGET, normalizeText(source), 'utf8')

  console.log('refactor.mjs: cleanup dependency handling repaired.')
}

function replaceDependencyRepairBlock(source) {
  const oldStart = [
    '  source = source.replaceAll(',
    "    'featureAvailability, runtime.mainWindow',",
  ].join('\n')

  const guardMarker = ['  if (', '    source.includes(', "      'featureAvailability',"].join('\n')

  const startIndex = source.indexOf(oldStart)

  const guardIndex = source.indexOf(guardMarker)

  const newBlock = `  source = source.replace(
    /\\[\\s*featureAvailability\\s*\\]/g,
    '[settingsUnavailable]',
  )

  source = replaceCallbackDependency(
    source,
    '  const minimizeWindow =',
    '  const maximizeWindow =',
    'windowControlsUnavailable',
    FILES.appShell,
  )

  source = replaceCallbackDependency(
    source,
    '  const maximizeWindow =',
    '  const openDeveloperTools =',
    'windowControlsUnavailable',
    FILES.appShell,
  )

  source = replaceCallbackDependency(
    source,
    '  const openDeveloperTools =',
    '  const startWindowDragging =',
    'developerToolsUnavailable',
    FILES.appShell,
  )

  source = replaceCallbackDependency(
    source,
    '  const startWindowDragging =',
    '  useApplicationCommands(',
    'windowDraggingUnavailable',
    FILES.appShell,
  )

`

  if (startIndex === -1) {
    if (source.includes('replaceCallbackDependency(')) {
      return source
    }

    throw new Error('Could not locate the old dependency replacement block in refactor.mjs.')
  }

  if (guardIndex === -1 || guardIndex <= startIndex) {
    throw new Error('Could not locate the featureAvailability verification guard.')
  }

  return source.slice(0, startIndex) + newBlock + source.slice(guardIndex)
}

function installDependencyHelper(source) {
  if (source.includes('function replaceCallbackDependency(')) {
    return source
  }

  const marker = 'function replaceRequired('

  const markerIndex = source.indexOf(marker)

  if (markerIndex === -1) {
    throw new Error('Could not locate replaceRequired() in refactor.mjs.')
  }

  const helper = `function replaceCallbackDependency(
  source,
  startMarker,
  endMarker,
  dependency,
  file,
) {
  const startIndex =
    source.indexOf(
      startMarker,
    )

  const endIndex =
    source.indexOf(
      endMarker,
      startIndex,
    )

  if (
    startIndex === -1 ||
    endIndex === -1
  ) {
    throw new Error(
      [
        'Could not locate callback section in',
        file + ':',
        startMarker,
      ].join(' '),
    )
  }

  const section =
    source.slice(
      startIndex,
      endIndex,
    )

  const dependencyPattern =
    /\\[\\s*(?:featureAvailability|windowControlsUnavailable|developerToolsUnavailable|windowDraggingUnavailable),\\s*runtime\\.mainWindow\\s*\\]/

  const expected =
    '[' +
    dependency +
    ', runtime.mainWindow]'

  if (
    !dependencyPattern.test(
      section,
    )
  ) {
    if (
      section.includes(expected)
    ) {
      return source
    }

    throw new Error(
      [
        'Could not locate main-window dependency array in',
        file + ':',
        startMarker,
      ].join(' '),
    )
  }

  const updatedSection =
    section.replace(
      dependencyPattern,
      expected,
    )

  return (
    source.slice(0, startIndex) +
    updatedSection +
    source.slice(endIndex)
  )
}

`

  return source.slice(0, markerIndex) + helper + source.slice(markerIndex)
}

function normalizeText(source) {
  return source.replace(/\r\n/g, '\n').trimEnd() + '\n'
}

main().catch((error) => {
  console.error('')
  console.error('Cleanup script repair failed.')

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  process.exitCode = 1
})
