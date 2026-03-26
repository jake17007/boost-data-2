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
