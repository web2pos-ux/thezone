import React, { useState, useEffect, useRef, useCallback } from 'react';
import OnlineOrderAcceptModal, { type OnlineOrderForAccept } from './OnlineOrderAcceptModal';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3177';

interface OnlineOrderAlertButtonProps {
  restaurantId: string | null;
  onOrderAccepted?: (order: OnlineOrderForAccept, readyTime: string) => void;
  onOrderRejected?: (order: OnlineOrderForAccept, reason: string) => void;
}

const OnlineOrderAlertButton: React.FC<OnlineOrderAlertButtonProps> = ({
  restaurantId,
  onOrderAccepted,
  onOrderRejected,
}) => {
  const [pendingQueue, setPendingQueue] = useState<OnlineOrderForAccept[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [connected, setConnected] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const pendingQueueRef = useRef<OnlineOrderForAccept[]>([]);

  useEffect(() => {
    pendingQueueRef.current = pendingQueue;
  }, [pendingQueue]);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/sounds/Online_Order.mp3');
      audioRef.current.preload = 'auto';
      audioRef.current.volume = 1.0;
    }
  }, []);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current || !audioRef.current) return;
    audioRef.current.volume = 0;
    audioRef.current.play()
      .then(() => {
        audioRef.current!.pause();
        audioRef.current!.currentTime = 0;
        audioRef.current!.volume = 1.0;
        audioUnlockedRef.current = true;
      })
      .catch(() => {});
  }, []);

  const playSound = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.volume = 1.0;
    audioRef.current.play().catch(() => {});
  }, []);

  useEffect(() => {
    if (!restaurantId) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `${API_BASE}/api/online-orders/stream/${restaurantId}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          setConnected(true);
          return;
        }

        if (data.type === 'new_order' && data.order) {
          const order: OnlineOrderForAccept = data.order;
          if (order.status === 'pending') {
            setPendingQueue(prev => {
              if (prev.some(o => o.id === order.id)) return prev;
              return [...prev, order];
            });
            playSound();
          }
          return;
        }

        if (data.type === 'order_updated' && data.order) {
          const order = data.order;
          if (order.status !== 'pending') {
            setPendingQueue(prev => prev.filter(o => o.id !== order.id));
          }
          return;
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [restaurantId, playSound]);

  const currentOrder = pendingQueue.length > 0 ? pendingQueue[0] : null;

  const handleAccept = useCallback((order: OnlineOrderForAccept, readyTime: string) => {
    setPendingQueue(prev => prev.filter(o => o.id !== order.id));
    if (onOrderAccepted) onOrderAccepted(order, readyTime);
    if (pendingQueueRef.current.length <= 1) {
      setShowModal(false);
    }
  }, [onOrderAccepted]);

  const handleReject = useCallback((order: OnlineOrderForAccept, reason: string) => {
    setPendingQueue(prev => prev.filter(o => o.id !== order.id));
    if (onOrderRejected) onOrderRejected(order, reason);
    if (pendingQueueRef.current.length <= 1) {
      setShowModal(false);
    }
  }, [onOrderRejected]);

  const handleButtonClick = useCallback(() => {
    unlockAudio();
    setShowModal(true);
  }, [unlockAudio]);

  if (pendingQueue.length === 0) return null;

  return (
    <>
      <button
        onClick={handleButtonClick}
        className="relative flex items-center justify-center bg-red-600 hover:bg-red-700 text-white font-bold rounded-md shadow-lg transition-all animate-pulse"
        style={{ width: 100, height: 35 }}
        title={`${pendingQueue.length} online order(s) waiting`}
      >
        <span className="text-xs">🔔 Order</span>
        {pendingQueue.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-yellow-400 text-black text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow">
            {pendingQueue.length}
          </span>
        )}
      </button>

      <OnlineOrderAcceptModal
        isOpen={showModal}
        order={currentOrder}
        queueCount={pendingQueue.length}
        restaurantId={restaurantId}
        onAccept={handleAccept}
        onReject={handleReject}
        onClose={() => setShowModal(false)}
      />
    </>
  );
};

export default OnlineOrderAlertButton;
