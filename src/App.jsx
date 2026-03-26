// @refresh reset
import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import WebcamRecorderNode from './nodes/WebcamRecorderNode';
import TranscriptNode from './nodes/TranscriptNode';
import TimeLapseNode from './nodes/TimeLapseNode';
import RemoveSilenceNode from './nodes/RemoveSilenceNode';
import AddCaptionsNode from './nodes/AddCaptionsNode';
import AddMusicNode from './nodes/AddMusicNode';
import PixelCaptionsNode from './nodes/PixelCaptionsNode';
import SaveVideoNode from './nodes/SaveVideoNode';
import ClaudePanel from './ClaudePanel';

const nodeTypes = {
  webcamRecorder: WebcamRecorderNode,
  transcript: TranscriptNode,
  timeLapse: TimeLapseNode,
  removeSilence: RemoveSilenceNode,
  addCaptions: AddCaptionsNode,
  addMusic: AddMusicNode,
  pixelCaptions: PixelCaptionsNode,
  saveVideo: SaveVideoNode,
};

const initialNodes = [
  {
    id: '1',
    type: 'webcamRecorder',
    position: { x: 100, y: 150 },
    data: {},
  },
  {
    id: '2',
    type: 'transcript',
    position: { x: 550, y: 0 },
    data: {},
  },
  {
    id: '3',
    type: 'timeLapse',
    position: { x: 550, y: 300 },
    data: {},
  },
  {
    id: '4',
    type: 'removeSilence',
    position: { x: 550, y: 600 },
    data: {},
  },
  {
    id: '5',
    type: 'addCaptions',
    position: { x: 950, y: 600 },
    data: {},
  },
  {
    id: '6',
    type: 'addMusic',
    position: { x: 1350, y: 600 },
    data: {},
  },
  {
    id: '8',
    type: 'saveVideo',
    position: { x: 1750, y: 600 },
    data: {},
  },
  {
    id: '7',
    type: 'pixelCaptions',
    position: { x: 950, y: 300 },
    data: {},
  },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e1-3', source: '1', target: '3', animated: true },
  { id: 'e1-4', source: '1', target: '4', animated: true },
  { id: 'e4-5', source: '4', target: '5', animated: true },
  { id: 'e5-6', source: '5', target: '6', animated: true },
  { id: 'e6-8', source: '6', target: '8', animated: true },
];

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background variant="dots" gap={16} size={1} />
        <Controls />
        <MiniMap />
      </ReactFlow>
      <ClaudePanel />
    </div>
  );
}
