import { createContext, useContext, useRef } from 'react';

// Simple pub/sub store for passing data between nodes via edges
const listeners = new Map();
const nodeData = new Map();

export function setNodeOutput(nodeId, data) {
  const prev = nodeData.get(nodeId);
  nodeData.set(nodeId, { ...prev, ...data });
  listeners.forEach((cb) => cb(nodeId, nodeData.get(nodeId)));
}

export function getNodeOutput(nodeId) {
  return nodeData.get(nodeId) || null;
}

export function subscribe(cb) {
  const id = Symbol();
  listeners.set(id, cb);
  return () => listeners.delete(id);
}

// Disabled nodes
const _loadDisabled = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem('disabled-nodes') || '[]'));
  } catch { return new Set(); }
};
const disabledNodes = _loadDisabled();
const _saveDisabled = () => localStorage.setItem('disabled-nodes', JSON.stringify([...disabledNodes]));

export function isNodeDisabled(nodeId) {
  return disabledNodes.has(nodeId);
}

export function toggleNodeDisabled(nodeId) {
  if (disabledNodes.has(nodeId)) {
    disabledNodes.delete(nodeId);
  } else {
    disabledNodes.add(nodeId);
  }
  _saveDisabled();
}
