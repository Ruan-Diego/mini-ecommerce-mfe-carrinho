import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import './drawer.css';

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  aberto: boolean;
  titulo: ReactNode;
  aoFechar: () => void;
  children: ReactNode;
  /** Nome acessível do botão de fechar. */
  rotuloFechar?: string;
}

/**
 * Painel lateral modal e acessível (o Modal do design-system é um diálogo central, então o drawer tem o seu):
 * role="dialog" com aria-modal e título; ao abrir, o foco vai para o painel e, ao fechar, volta para quem
 * estava focado. Tab fica preso dentro dele. Fecha com Esc, clique no fundo ou no X.
 * Fechado, não renderiza nada.
 */
export function Drawer({ aberto, titulo, aoFechar, children, rotuloFechar = 'Fechar' }: Props) {
  const idTitulo = useId();
  const painel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    painel.current?.focus();
    return () => anterior?.focus?.();
  }, [aberto]);

  if (!aberto) return null;

  function aoTeclar(evento: KeyboardEvent<HTMLElement>) {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      aoFechar();
      return;
    }
    if (evento.key !== 'Tab' || !painel.current) return;
    const focaveis = Array.from(painel.current.querySelectorAll<HTMLElement>(FOCAVEIS));
    if (focaveis.length === 0) {
      evento.preventDefault();
      return;
    }
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const atual = document.activeElement;
    if (evento.shiftKey && (atual === primeiro || atual === painel.current)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && atual === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  function aoClicarNoFundo(evento: MouseEvent<HTMLDivElement>) {
    if (evento.target === evento.currentTarget) aoFechar();
  }

  return (
    // O clique no fundo é só conveniência de mouse: quem usa teclado ou leitor de tela fecha com Esc ou com o X.
    // O onKeyDown do diálogo implementa o foco preso (Tab) e o Esc, que o lint não sabe reconhecer.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="drawer-bg" onMouseDown={aoClicarNoFundo}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <aside ref={painel} className="drawer" role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1} onKeyDown={aoTeclar}>
        <div className="drawer-hd">
          <h2 id={idTitulo} className="h3">{titulo}</h2>
          <button type="button" className="iconbtn" aria-label={rotuloFechar} onClick={aoFechar}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
