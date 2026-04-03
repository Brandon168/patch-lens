import { type InferAgentUIMessage } from 'ai';
import { prReviewAgent } from '@/lib/agents/pr-review-agent';
import { type ReviewMessageMetadata } from '@/lib/review-types';

export type ReviewUIMessage = InferAgentUIMessage<
  typeof prReviewAgent,
  ReviewMessageMetadata
>;
