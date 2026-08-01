import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/app/routes';
import { AuthProvider } from '@/features/auth';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;