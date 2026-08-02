export type { RawKafkaHeaderMap } from './kafka-trace-propagation';
export {
  captureActiveTraceContext,
  injectTraceContext,
  runWithExtractedContext,
  runWithTraceParent,
} from './kafka-trace-propagation';
export type { SagaOutcome } from './metrics';
export { recordDlqMessage, recordOrderPlaced, recordSagaOutcome } from './metrics';
export { registerTracing } from './register';
