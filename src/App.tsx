import { Route, Routes } from 'react-router-dom';
import type { PropsRemoto } from './contracts';
import { Carrinho } from './pages/Carrinho';
import { MiniCarrinho } from './pages/MiniCarrinho';

/**
 * Módulo exposto como ./App. O shell monta este componente numa rota com "/*",
 * então as rotas abaixo são relativas a props.basePath.
 */
export default function App(_props: PropsRemoto) {
  return (
    <Routes>
      <Route index element={<Carrinho />} />
      <Route path="mini" element={<MiniCarrinho />} />
      <Route path="*" element={<p className="wrap muted">Página não encontrada neste microfrontend.</p>} />
    </Routes>
  );
}
