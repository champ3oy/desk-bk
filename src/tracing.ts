import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
// process is global in Node.js
import * as dotenv from 'dotenv';

// Load environment variables manually since this file runs before NestJS ConfigModule
dotenv.config();

// Configure the trace exporter
const traceExporter = new OTLPTraceExporter({
  url:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    'https://in.otel.betterstack.com/v1/traces',
  headers: {
    Authorization: `Bearer ${process.env.BETTERSTACK_OTEL_TOKEN}`,
  },
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: 'morph-desk-backend',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // specialized config for certain instrumentations if needed
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Too noisy usually
      },
    }),
  ],
});

// efficiently shut down the SDK on process exit
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

try {
  sdk.start();
  console.log('OpenTelemetry Tracing initialized');
} catch (e) {
  console.error('Error initializing OpenTelemetry Tracing', e);
}
