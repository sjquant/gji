export default function clipboardFallbackPlugin() {
  return {
    name: 'clipboard-fallback',
    getClientModules() {
      return ['./src/clipboardFallback.ts'];
    },
  };
}
