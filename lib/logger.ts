export const logger = {
  error: (scope: string, err: any) => {
    // In a real app, this might send to Sentry, Datadog, etc.
    // For now, it's a consistent wrapper around console.error.
    console.error(`[${scope}]`, err);
  },
};
