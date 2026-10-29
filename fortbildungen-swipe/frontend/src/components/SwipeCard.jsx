import React, { useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { formatDateTime } from '../lib/format.js';

const SWIPE_THRESHOLD = 120;

export default function SwipeCard({ training, isTop, onSwiped, zIndex }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-18, 18]);
  const likeOpacity = useTransform(x, [20, 120], [0, 1]);
  const nopeOpacity = useTransform(x, [-120, -20], [1, 0]);
  const [exitX, setExitX] = useState(0);

  function handleDragEnd(_e, info) {
    if (info.offset.x > SWIPE_THRESHOLD) {
      setExitX(600);
      onSwiped('right');
    } else if (info.offset.x < -SWIPE_THRESHOLD) {
      setExitX(-600);
      onSwiped('left');
    }
  }

  return (
    <motion.div
      className="swipe-card"
      style={{ x, rotate, zIndex }}
      drag={isTop ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={1}
      onDragEnd={handleDragEnd}
      animate={isTop ? { scale: 1, y: 0 } : { scale: 0.96, y: 10 }}
      exit={{ x: exitX, opacity: 0, transition: { duration: 0.35 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {isTop && (
        <>
          <motion.div className="stamp stamp-like" style={{ opacity: likeOpacity }}>
            INTERESSE
          </motion.div>
          <motion.div className="stamp stamp-nope" style={{ opacity: nopeOpacity }}>
            KEIN INTERESSE
          </motion.div>
        </>
      )}

      <div className="swipe-card-body">
        <h2>{training.title}</h2>
        <p className="training-datetime">{formatDateTime(training.date, training.time)}</p>
        {training.location && <p className="training-location">📍 {training.location}</p>}
        {training.description && <p className="training-description">{training.description}</p>}
        <p className="training-organizer">Angeboten von {training.organizerName}</p>
      </div>
    </motion.div>
  );
}
