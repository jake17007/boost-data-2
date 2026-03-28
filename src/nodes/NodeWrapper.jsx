import { useNodeId } from '@xyflow/react';
import { useNodeEnabled } from './useNodeEnabled';

export default function NodeWrapper({ children, className }) {
  const nodeId = useNodeId();
  const { enabled, toggle } = useNodeEnabled(nodeId);

  return (
    <div className={`${className || ''} ${!enabled ? 'node-disabled' : ''}`}>
      <button
        className={`node-power-btn ${enabled ? 'node-power-on' : 'node-power-off'}`}
        title={enabled ? 'Disable node' : 'Enable node'}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        ⏻
      </button>
      {children}
    </div>
  );
}
