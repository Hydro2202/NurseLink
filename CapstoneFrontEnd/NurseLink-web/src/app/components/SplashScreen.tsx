import { useEffect, useState } from 'react';
import logoImage from 'figma:asset/3d9b7c179afc2d98d9124ffe39a7807d2ffa64d9.png';

interface SplashScreenProps {
  onComplete: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [isAnimating, setIsAnimating] = useState(true);

  useEffect(() => {
    // Auto-transition after 2.5 seconds
    const timer = setTimeout(() => {
      setIsAnimating(false);
      // Give fade-out animation time to complete before calling onComplete
      setTimeout(onComplete, 500);
    }, 2500);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 transition-opacity duration-500 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className={`flex flex-col items-center justify-center transition-all duration-1000 ${
          isAnimating
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-95'
        }`}
        style={{
          animation: isAnimating ? 'splashFadeIn 1s ease-out forwards' : 'none',
        }}
      >
        <img
          src={logoImage}
          alt="NurseLink Logo"
          className="w-48 h-48 md:w-64 md:h-64 object-contain"
        />
        <div className="mt-6 flex space-x-2">
          <div
            className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"
            style={{ animationDelay: '0ms' }}
          ></div>
          <div
            className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"
            style={{ animationDelay: '150ms' }}
          ></div>
          <div
            className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"
            style={{ animationDelay: '300ms' }}
          ></div>
        </div>
      </div>

      <style>{`
        @keyframes splashFadeIn {
          0% {
            opacity: 0;
            transform: scale(0.8);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
