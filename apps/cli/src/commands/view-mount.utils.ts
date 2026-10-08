import { type Instance, render } from 'ink';
import type { ReactElement } from 'react';

export interface ViewMount {
  show(element: ReactElement): void;
  unmount(): void;
}

export function createViewMount(onExit: () => void): ViewMount {
  let instance: Instance | undefined;
  let exited = false;

  return {
    show: (element) => {
      if (exited) {
        return;
      }
      if (instance) {
        instance.rerender(element);
        return;
      }
      instance = render(element);
      void instance.waitUntilExit().then(() => {
        exited = true;
        onExit();
      });
    },
    unmount: () => instance?.unmount(),
  };
}
