import { Streamdown, defaultRehypePlugins } from "streamdown";

// Everything Streamdown runs over a reply but the pass that turns HTML in it into elements: the agent's
// markup is shown as it wrote it, never run.
const { raw: _raw, ...kept } = defaultRehypePlugins;
const REHYPE = Object.values(kept);

const COMPONENTS = {
  // A picture in a reply would be fetched from wherever the reply says, on the owner's browser. Its address is shown instead.
  img: ({ src, alt }: { src?: unknown; alt?: unknown }) => {
    const href = typeof src === "string" ? src : "";
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {typeof alt === "string" && alt ? alt : href}
      </a>
    );
  },
};

/**
 * The agent's words as markdown (ADR 0055): headings, lists, code, tables, links. `writing` says the
 * reply is still arriving, so a half-written emphasis or code fence is closed for now and not shown
 * as stray marks. Streamdown's own buttons are off: their labels are not from the message table.
 * It is loaded only when a chat has a reply to show.
 */
export default function ChatReply({ text, writing }: { text: string; writing: boolean }) {
  return (
    <Streamdown mode={writing ? "streaming" : "static"} isAnimating={writing} parseIncompleteMarkdown={writing} controls={false} linkSafety={{ enabled: false }} lineNumbers={false} rehypePlugins={REHYPE} components={COMPONENTS}>
      {text}
    </Streamdown>
  );
}
