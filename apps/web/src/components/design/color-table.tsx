import { TokenValue } from "@/components/design/token-value";
import { cn } from "@/lib/utils";

export interface ColorToken {
  name: string;
  usage: string;
}

function ThemeSwatch({ theme, token }: { theme: "light" | "dark"; token: string }) {
  return (
    <div
      className={cn(
        theme,
        "flex min-w-0 items-center gap-3 rounded-lg bg-background p-2 text-foreground ring-1 ring-foreground/8"
      )}
    >
      <span
        className="size-8 shrink-0 rounded-md ring-1 ring-foreground/10 ring-inset"
        style={{ background: `var(${token})` }}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-[0.6875rem] text-muted-foreground capitalize">{theme}</span>
        <TokenValue className="truncate text-foreground" token={token} />
      </span>
    </div>
  );
}

export function ColorTable({ title, tokens }: { title: string; tokens: ColorToken[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-sm">{title}</h3>
      <div className="flex flex-col divide-y rounded-xl bg-card px-4 shadow-xs ring-1 ring-foreground/6 sm:px-5">
        {tokens.map((token) => (
          <div
            className="grid gap-3 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_minmax(0,15rem)] md:items-center"
            key={token.name}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <code className="numeric font-medium text-sm">--{token.name}</code>
              <span className="text-muted-foreground text-xs">{token.usage}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:contents">
              <ThemeSwatch theme="light" token={`--${token.name}`} />
              <ThemeSwatch theme="dark" token={`--${token.name}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
