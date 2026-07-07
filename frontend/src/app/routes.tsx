import { Routes, Route } from 'react-router-dom';
import Room from '@/pages/Room';

export const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Room />} />
      <Route path="/room/:id" element={<Room />} />
    </Routes>
  );
};
