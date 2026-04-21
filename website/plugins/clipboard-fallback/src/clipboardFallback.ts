function installClipboardFallback() {
  if (typeof window === 'undefined' || !navigator.clipboard?.writeText) {
    return;
  }

  const clipboard = navigator.clipboard as Clipboard & {
    __gjiFallbackInstalled?: boolean;
  };

  if (clipboard.__gjiFallbackInstalled) {
    return;
  }

  const originalWriteText = clipboard.writeText.bind(clipboard);

  async function writeTextWithFallback(text: string) {
    try {
      return await originalWriteText(text);
    } catch (error) {
      const copied = copyTextFallback(text);

      if (copied) {
        return;
      }

      throw error;
    }
  }

  try {
    clipboard.writeText = writeTextWithFallback;
    clipboard.__gjiFallbackInstalled = true;
  } catch {
    // Some runtimes may expose a non-writable clipboard object.
    // In that case we leave the default behavior unchanged.
  }
}

installClipboardFallback();

function copyTextFallback(text: string) {
  if (typeof document === 'undefined') {
    return false;
  }

  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textArea = document.createElement('textarea');

  textArea.value = text;
  textArea.setAttribute('readonly', 'true');
  textArea.setAttribute('aria-hidden', 'true');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '-9999px';
  textArea.style.opacity = '0';

  document.body.append(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  let copied = false;

  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textArea.remove();
  activeElement?.focus();

  return copied;
}
