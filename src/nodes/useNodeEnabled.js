import { useState } from 'react';
import { isNodeDisabled, toggleNodeDisabled } from '../store';

export function useNodeEnabled(nodeId) {
  const [enabled, setEnabled] = useState(() => !isNodeDisabled(nodeId));

  const toggle = () => {
    toggleNodeDisabled(nodeId);
    setEnabled(!enabled);
  };

  return { enabled, toggle };
}
