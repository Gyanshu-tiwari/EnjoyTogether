import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/app/routes';
import { AuthProvider } from '@/features/auth';
import { InvitationProvider } from '@/features/invitations';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <InvitationProvider>
          <AppRoutes />
        </InvitationProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
