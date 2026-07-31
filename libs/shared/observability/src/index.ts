export type { RawKafkaHeaderMap } from './kafka-trace-propagation';
export {
  captureActiveTraceContext,
  injectTraceContext,
  runWithExtractedContext,
  runWithTraceParent,
} from './kafka-trace-propagation';
export { registerTracing } from './register';
