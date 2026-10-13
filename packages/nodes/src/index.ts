import type { NodeDefinition } from '@anygen/core'
import { speechToTextNode, textToSpeechNode } from './audio/audio'
import { previewNode, switchNode } from './core/flow'
import { htmlToTextNode } from './core/html-to-text'
import { loadAudioNode, loadImageNode, loadVideoNode } from './core/load-media'
import { numberNode, seedNode } from './core/number'
import { saveFileNode, saveJsonNode } from './core/save'
import { templateNode } from './core/template'
import { concatNode, textNode } from './core/text'
import { customCodeNode } from './generic/code'
import { httpRequestNode } from './generic/http'
import { imageGenerateNode, imageToImageNode } from './image/image'
import { resizeImageNode } from './image/resize'
import { chatNode, visionNode } from './llm/chat'
import { structuredOutputNode, visionStructuredNode } from './llm/structured'
import { factsExtractorNode } from './quiz/facts'
import { quizFromFactsNode } from './quiz/node'
import { videoGenerateNode } from './video/video'

export { concatNode, textNode }
export { createModelResolver, getModels, type ModelResolver } from './ai/models'
export { loadModelNodes, modelNodes, DEFAULT_MODELS, type ModelEntry } from './llm/models-config'
export { htmlToText } from './core/html-to-text'
export { renderTemplate } from './core/template'
export { runSandboxed } from './generic/code'
export { buildQuiz, checkQuiz, modelQuizSchema, quizPrompt } from './quiz/quiz'

/** Built-in node definitions, in the order they appear in the palette within a category. */
export const builtinNodes: NodeDefinition[] = [
  // Input
  textNode,
  numberNode,
  seedNode,
  loadImageNode,
  loadAudioNode,
  loadVideoNode,
  // Utility
  concatNode,
  templateNode,
  htmlToTextNode,
  switchNode,
  // LLM
  chatNode,
  visionNode,
  structuredOutputNode,
  visionStructuredNode,
  // Quiz
  factsExtractorNode,
  quizFromFactsNode,
  // Image
  imageGenerateNode,
  imageToImageNode,
  resizeImageNode,
  // Audio
  textToSpeechNode,
  speechToTextNode,
  // Video
  videoGenerateNode,
  // Generic
  httpRequestNode,
  customCodeNode,
  // Output
  previewNode,
  saveJsonNode,
  saveFileNode,
]
