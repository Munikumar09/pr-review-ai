export const EXTENSION_ID = 'azurePrReview';

export const SECRET_KEYS = {
  pat: 'azurePrReview.pat',
} as const;

export const CONFIG_KEYS = {
  organization: 'organization',
  project: 'project',
  repository: 'repository',
  aiProvider: 'ai.provider',
  aiMaxFindings: 'ai.maxFindings',
  aiMinConfidence: 'ai.minConfidence',
  aiReviewCategories: 'ai.reviewCategories',
  aiCustomInstructions: 'ai.customInstructions',
  aiIncludeAttribution: 'ai.includeAttributionInComments',
  opencodeCommand: 'opencode.command',
  opencodeModel: 'opencode.model',
  copilotModel: 'copilot.model',
  loggingLevel: 'logging.level',
  secretDetection: 'security.secretDetection',
} as const;
