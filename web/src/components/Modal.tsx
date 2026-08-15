import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface ModalApi {
  openModal: (content: ReactNode) => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalApi>({ openModal: () => {}, closeModal: () => {} });

export function ModalProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const openModal = useCallback((c: ReactNode) => setContent(c), []);
  const closeModal = useCallback(() => setContent(null), []);
  return (
    <ModalContext.Provider value={{ openModal, closeModal }}>
      {children}
      <div id="modal-root">
        {content != null && (
          <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
            <div className="modal">{content}</div>
          </div>
        )}
      </div>
    </ModalContext.Provider>
  );
}

export const useModal = () => useContext(ModalContext);
