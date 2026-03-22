import React from 'react';

export default function ArrowUpIcon({ className, size = 20 }) {
  return (
    <svg
      className={ className }
      width={ size }
      height={ size }
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
