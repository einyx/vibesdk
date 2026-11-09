import { ModelSize, type AIModelConfig } from '../inferutils/config.types';

export const THINK_MODEL_ID = 'glm-4.6';

export const THINK_MODEL_CONFIG: AIModelConfig = {
	name: 'GLM 4.6',
	size: ModelSize.REGULAR,
	provider: 'zhipu',
	creditCost: 2,
	contextSize: 200_000,
	directOverride: true,
};
