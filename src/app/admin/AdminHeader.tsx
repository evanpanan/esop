import Link from "next/link";
import { AdminLogoUploader, PrivacyToggleButton } from "@/app/ClientAnimations";
import type { ReactNode } from "react";

export default function AdminHeader({
  lang,
  title,
  subtitle,
  logoDataUrl,
  logoReturnTo,
  uploadBrandLogoAction,
  changePasswordHref,
  changePasswordLabel,
  logoutHref,
  logoutAction,
  logoutLabel,
  currencyLangSwitch,
  mobileMenuButton,
  currentUserEmail,
  currentUserRole,
  isRootSuperAdmin,
}: {
  lang: "zh-CN" | "zh-TW" | "en";
  title: string;
  subtitle: string;
  logoDataUrl: string;
  logoReturnTo: string;
  uploadBrandLogoAction: (formData: FormData) => Promise<void>;
  changePasswordHref: string;
  changePasswordLabel: string;
  logoutHref?: string;
  logoutAction: (formData: FormData) => Promise<void>;
  logoutLabel: string;
  currencyLangSwitch?: ReactNode;
  mobileMenuButton?: ReactNode;
  currentUserEmail: string;
  currentUserRole: string;
  isRootSuperAdmin: boolean;
}) {
  return (
    <div className="flex max-w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5">
          <AdminLogoUploader
            action={uploadBrandLogoAction}
            lang={lang}
            returnTo={logoReturnTo}
            logoDataUrl={logoDataUrl}
          />
        </div>
        <div className="min-w-0 flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl">{title}</h1>
          <p className="text-xs leading-5 text-zinc-600 sm:text-sm sm:leading-6">{subtitle}</p>
        </div>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          {currencyLangSwitch ?? null}
          {mobileMenuButton ? <div className="sm:hidden">{mobileMenuButton}</div> : null}
          <PrivacyToggleButton />
          <Link
            href={changePasswordHref}
            className="btn-press btn-ripple hidden h-9 touch-manipulation items-center justify-center rounded-xl border border-black/5 bg-white/80 px-3 text-xs font-semibold text-zinc-900 hover:bg-white sm:inline-flex"
            scroll={false}
          >
            {changePasswordLabel}
          </Link>
          {logoutHref ? (
            <a
              href={logoutHref}
              target="_top"
              className="btn-press btn-ripple hidden h-9 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-3 text-xs font-semibold text-white hover:bg-zinc-800 sm:inline-flex"
            >
              {logoutLabel}
            </a>
          ) : (
            <form action={logoutAction}>
              <input type="hidden" name="lang" value={lang} />
              <button
                type="submit"
                className="btn-press btn-ripple hidden h-9 touch-manipulation items-center justify-center rounded-xl bg-zinc-900 px-3 text-xs font-semibold text-white hover:bg-zinc-800 sm:inline-flex"
              >
                {logoutLabel}
              </button>
            </form>
          )}
        </div>
        <div className="break-words text-[11px] text-zinc-500">
          <span className="font-mono">{currentUserEmail}</span>{" "}
          <span className="text-zinc-400">·</span>{" "}
          <span className="font-mono">
            {currentUserRole}
            {isRootSuperAdmin ? " · ROOT" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
