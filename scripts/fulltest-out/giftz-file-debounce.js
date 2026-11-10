function debounce(fn, wait) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Usage example:
const logMessage = message => console.log(message);
const debouncedLog = debounce(logMessage, 1000);

debouncedLog('Hello');
debouncedLog('World');
// Only 'World' will be logged after 1 second of inactivity
