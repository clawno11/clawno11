import { CheckCircle2 } from "lucide-react";

export const DEFAULT_PORT = 18789;

export const REQUIRED_SCOPES = [
  "im:message",
  "im:message:send_as_bot",
  "im:resource",
];

/**
 * Render a step description that may contain safe inline links/code.
 * Instead of dangerouslySetInnerHTML, we parse a small known subset:
 * <a href="..." target="_blank" rel="...">text</a> and <code>text</code>.
 * Unrecognised tags are stripped.
 */
export function SafeStepHtml({ html }: { html: string }) {
  const parts = html.split(/(<a [^>]+>.*?<\/a>|<code[^>]*>.*?<\/code>)/g);
  return (
    <>
      {parts.map((part, i) => {
        const aMatch = part.match(/^<a href="([^"]+)"[^>]*>(.*?)<\/a>$/);
        if (aMatch) {
          return (
            <a
              key={i}
              href={aMatch[1]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {aMatch[2]}
            </a>
          );
        }
        const codeMatch = part.match(/^<code[^>]*>(.*?)<\/code>$/);
        if (codeMatch) {
          return (
            <code key={i} className="bg-muted px-1 rounded text-xs">
              {codeMatch[1]}
            </code>
          );
        }
        return <span key={i}>{part.replace(/<[^>]+>/g, "")}</span>;
      })}
    </>
  );
}

export function GuideSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2.5 mt-3">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
            {i + 1}
          </span>
          <span className="leading-relaxed whitespace-pre-line">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** Step indicator dot used by FeishuWizard */
export function StepDot({ index, current }: { index: number; current: number }) {
  if (index < current) {
    return (
      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-green-500 text-white">
        <CheckCircle2 size={12} />
      </div>
    );
  }
  return (
    <div
      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
        index === current
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {String(index + 1)}
    </div>
  );
}
