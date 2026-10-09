export interface LineSplitter {
  push(chunk: string): void;
  flush(): void;
}

export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  let pending = '';

  const emit = (line: string) => onLine(line.endsWith('\r') ? line.slice(0, -1) : line);

  return {
    push: (chunk) => {
      const parts = (pending + chunk).split('\n');
      pending = parts.pop() ?? '';
      parts.forEach(emit);
    },
    flush: () => {
      if (pending.length > 0) {
        const last = pending;
        pending = '';
        emit(last);
      }
    },
  };
}
