import { type InferAgentUIMessage } from 'ai';
import { prReviewAgent } from '@/features/review/agent';
import { type ReviewMessageMetadata } from '@/features/review/schema';

export type ReviewUIMessage = InferAgentUIMessage<
  typeof prReviewAgent,
  ReviewMessageMetadata
>;
