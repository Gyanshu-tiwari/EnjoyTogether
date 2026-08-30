import React from 'react';
import { LoginForm as AuthLoginForm } from '@/features/auth';

export const Login: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center w-full relative">
      {/* Background decorations */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-brand/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="relative z-10 w-full flex justify-center mt-[-40px]">
        <AuthLoginForm />
      </div>
    </div>
  );
};

export default Login;
