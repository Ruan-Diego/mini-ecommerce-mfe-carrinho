import { Route, Routes } from 'react-router-dom';
import type { PropsRemoto } from '@ruan-diego/mini-event-contracts';
import { Carrinho } from './pages/Carrinho';
import { MiniCarrinho } from './pages/MiniCarrinho';

/**
 * Módulo exposto como ./App. O shell monta este componente numa rota com "/*",
 * então as rotas abaixo são relativas a props.basePath.
 */
export default function App({ eventBus, getToken }: PropsRemoto) {
  return (
    <Routes>
      <Route index element={<Carrinho eventBus={eventBus} getToken={getToken} />} />
      <Route path="mini" element={<MiniCarrinho eventBus={eventBus} getToken={getToken} />} />
      <Route path="*" element={<p className="wrap muted">Página não encontrada neste microfrontend.</p>} />
    </Routes>
  );
}
