import { createGateway, type GatewayModelId } from 'ai';

export const DEFAULT_REVIEW_MODEL_ID: GatewayModelId =
  'openai/gpt-5.4-mini';

export const reviewModelId = (process.env.PATCH_LENS_MODEL_ID?.trim() ||
  DEFAULT_REVIEW_MODEL_ID) as GatewayModelId;

const reviewGateway = createGateway({
  apiKey: process.env.PATCH_LENS_GATEWAY_API_KEY?.trim(),
});

export const reviewLanguageModel = reviewGateway(reviewModelId);

export function hasReviewModelAccess(): boolean {
  return Boolean(process.env.PATCH_LENS_GATEWAY_API_KEY?.trim());
}
