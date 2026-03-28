// @refresh reset
import { useCallback, useEffect, useRef } from 'react';
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
import DirectoryLoaderNode from './nodes/DirectoryLoaderNode';
import SyncMergeNode from './nodes/SyncMergeNode';
import TimelineEditorNode from './nodes/TimelineEditorNode';
import RotateVideoNode from './nodes/RotateVideoNode';
import TimestampTranscriptNode from './nodes/TimestampTranscriptNode';
import BRollNode from './nodes/BRollNode';
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
  directoryLoader: DirectoryLoaderNode,
  syncMerge: SyncMergeNode,
  timelineEditor: TimelineEditorNode,
  rotateVideo: RotateVideoNode,
  timestampTranscript: TimestampTranscriptNode,
  broll: BRollNode,
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
  {
    id: '9',
    type: 'directoryLoader',
    position: { x: 100, y: 700 },
    data: {},
  },
  {
    id: '10',
    type: 'syncMerge',
    position: { x: 550, y: 700 },
    data: {},
  },
  {
    id: '11',
    type: 'saveVideo',
    position: { x: 950, y: 700 },
    data: {},
  },
  {
    id: '12',
    type: 'timelineEditor',
    position: { x: 1350, y: 700 },
    data: {},
  },
  {
    id: '13',
    type: 'saveVideo',
    position: { x: 1750, y: 700 },
    data: {},
  },
  {
    id: '14',
    type: 'rotateVideo',
    position: { x: 2150, y: 700 },
    data: {},
  },
  {
    id: '15',
    type: 'saveVideo',
    position: { x: 2550, y: 700 },
    data: {},
  },
  {
    id: '16',
    type: 'timestampTranscript',
    position: { x: 1926, y: 1200 },
    data: {},
  },
  {
    id: '17',
    type: 'broll',
    position: { x: 2350, y: 1200 },
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
  { id: 'e9-10', source: '9', target: '10', animated: true },
  { id: 'e10-11', source: '10', target: '11', animated: true },
  { id: 'e11-12', source: '11', target: '12', animated: true },
  { id: 'e12-13', source: '12', target: '13', animated: true },
  { id: 'e13-14', source: '13', target: '14', animated: true },
  { id: 'e14-15', source: '14', target: '15', animated: true },
  { id: 'e13-16', source: '13', target: '16', animated: true },
  { id: 'e16-17', source: '16', target: '17', animated: true },
];

const API = 'http://localhost:8000';

function useDebouncedSave(nodes, edges) {
  const timer = useRef(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!loaded.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const stripped = nodes.map(({ id, type, position, data }) => ({ id, type, position, data }));
      fetch(`${API}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: stripped, edges }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer.current);
  }, [nodes, edges]);

  return loaded;
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const loaded = useDebouncedSave(nodes, edges);

  useEffect(() => {
    fetch(`${API}/workflow`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.nodes) {
          setNodes(data.nodes);
          setEdges(data.edges || []);
        } else {
          setNodes(initialNodes);
          setEdges(initialEdges);
        }
      })
      .catch(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
      })
      .finally(() => { loaded.current = true; });
  }, []);

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
