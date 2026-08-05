export interface SettingsClientLogger {
  warn(message: string): void;
}

export interface ConfigEventsConsumerLogger extends SettingsClientLogger {
  log(message: string): void;
}
