"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import {
  LayoutDashboard,
  ShoppingBag,
  ClipboardList,
  Package,
  Boxes,
  Truck,
  Users,
  Megaphone,
  Wallet,
  ChartNoAxesCombined,
  Settings,
  ShoppingCart,
  Menu,
  X,
  Store as StoreIcon,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { navigation } from "@/packages/config/navigation";
import type { Store, Organization } from "@/packages/domain/tenancy";
import { changeContext, logout } from "@/app/actions";
const PreviewContext = createContext({ base: "/app", storeName: "" });
export const usePreview = () => useContext(PreviewContext);
const icons = {
  overview: LayoutDashboard,
  sales: ShoppingCart,
  orders: ClipboardList,
  products: ShoppingBag,
  inventory: Boxes,
  procurement: Package,
  customers: Users,
  logistics: Truck,
  marketing: Megaphone,
  finance: Wallet,
  reports: ChartNoAxesCombined,
  settings: Settings,
};
function ContextSubmit() {
  const { pending } = useFormStatus();
  return (
    <button className="context-button" disabled={pending}>
      {pending ? "Aplicando…" : "Aplicar"}
    </button>
  );
}
export function Shell({
  children,
  organizations,
  stores,
  active,
  demo,
}: {
  children: React.ReactNode;
  organizations: Organization[];
  stores: Store[];
  active: Store;
  demo: boolean;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(active);
  const [orgId, setOrgId] = useState(active.organization_id);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const base = demo ? "/demo" : "/app";
  const store = demo ? chosen : active;
  const options = stores.filter((s) => s.organization_id === orgId);
  return (
    <PreviewContext.Provider value={{ base, storeName: store.name }}>
      <a href="#main" className="skip">
        Pular para conteúdo
      </a>
      <div className="workspace">
        {open && (
          <button
            className="scrim"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
          />
        )}
        <aside
          className={`sidebar ${open ? "is-open" : ""}`}
          aria-label="Navegação principal"
        >
          <div className="sidebar-top">
            <Link href={`${base}/visao-geral`} className="brand">
              comércio<span>360</span>
            </Link>
            <button
              className="mobile icon-button"
              aria-label="Fechar menu"
              onClick={() => setOpen(false)}
            >
              <X />
            </button>
          </div>
          <div className="workspace-label">ESPAÇO DE TRABALHO</div>
          <nav>
            {navigation.map((item) => {
              const Icon = icons[item.icon];
              const selected =
                path === `${base}/${item.slug}` ||
                (path === "/demo" && item.slug === "visao-geral");
              return (
                <Link
                  aria-current={selected ? "page" : undefined}
                  className={selected ? "nav-item active" : "nav-item"}
                  key={item.slug}
                  href={`${base}/${item.slug}`}
                  onClick={() => setOpen(false)}
                >
                  <Icon size={19} />
                  <span>{item.label}</span>
                  {item.slug === "visao-geral" && <span className="nav-dot" />}
                </Link>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <div className="mini-mark">360</div>
            <div>
              <strong>Fundação do produto</strong>
              <small>Versão 0.1 · Pacote 001</small>
            </div>
          </div>
        </aside>
        <div className="main-column">
          <header className="topbar">
            <div className="topbar-title">
              <button
                className="mobile icon-button"
                aria-label="Abrir menu"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                <Menu />
              </button>
              <StoreIcon size={21} />
              <span>Sua operação</span>
            </div>
            <div className="topbar-right">
              <span className="status-dot" />
              <span className="desktop-label">
                {demo ? "Demonstração" : "Área autenticada"}
              </span>
              {demo ? (
                <Link href="/login" className="text-button">
                  Entrar <LogOut size={16} />
                </Link>
              ) : (
                <form action={logout}>
                  <button className="text-button">
                    Sair <LogOut size={16} />
                  </button>
                </form>
              )}
            </div>
          </header>
          <div className="context-strip">
            <form
              action={demo ? undefined : changeContext}
              onSubmit={
                demo
                  ? (event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const next = stores.find(
                        (s) => s.id === data.get("storeId"),
                      );
                      if (next) setChosen(next);
                    }
                  : undefined
              }
              key={active.id}
            >
              <label>
                <span>Empresa</span>
                <select
                  name="organizationId"
                  aria-label="Empresa"
                  value={orgId}
                  onChange={(event) => setOrgId(event.target.value)}
                >
                  {organizations.map((o) => (
                    <option value={o.id} key={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <ChevronDown size={14} />
              <label>
                <span>Loja</span>
                <select
                  key={orgId}
                  name="storeId"
                  aria-label="Loja"
                  defaultValue={
                    store.organization_id === orgId ? store.id : options[0]?.id
                  }
                >
                  {options.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <ContextSubmit />
            </form>
            <span className="context-note">
              {demo ? "Ambiente de demonstração" : "Acesso por empresa e loja"}
            </span>
          </div>
          <main id="main" className="content" tabIndex={-1}>
            {children}
          </main>
          <footer className="page-footer">
            Comércio 360 <span>Organização em cada detalhe.</span>
          </footer>
        </div>
      </div>
    </PreviewContext.Provider>
  );
}
