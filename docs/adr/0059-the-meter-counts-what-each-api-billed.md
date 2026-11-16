# 0059. The meter counts what each API says it billed, and the generation scripts go through the proxy

Status: Accepted. Builds on [0040](./0040-generated-art-and-sound-from-briefs.md) and
[0047](./0047-the-chat-runs-an-agent-the-service-holds-to-the-puzzle.md). It supersedes
[0051](./0051-takes-are-kept-in-a-railway-bucket-by-their-hash.md) decision 7 (a take is counted
at an estimate), and the words of 0047 decision 2 that put the two generation scripts' keys in
the agent's environment. Everything else in both stands.

## Context

The chat's meter had two halves. A model turn was counted from the usage on each Messages API
response, priced by a table beside the proxy (ADR 0047 decision 3). A take was counted after the
turn at a fixed sum, a quarter of a dollar a sprite and five cents a sound, because the scripts
paid with keys in the agent's shell and the service never saw their responses (ADR 0051). The
owner asked for the true cost of all three APIs instead of estimates, read from their responses.

None of the three answers in dollars. Each says, on every response, what it billed in its own
unit:

- **Anthropic**: tokens by kind (`usage`: input, output, cache reads, cache writes split by their
  lifetime), the model that answered, and `speed` when it ran fast.
- **OpenAI's Images API**: tokens by kind (`usage`: text and image input, cached input, image
  output).
- **ElevenLabs**: the credits it charged, in the `character-cost` header.

A dollar figure per request exists only in each provider's billing reports, a day or more later
and by account, too late to stop a turn.

## Decision

1. **The generation scripts reach their APIs through the service's proxy.** The proxy answers
   Anthropic at its root, OpenAI under `/openai` and ElevenLabs under `/elevenlabs`. The agent's
   shell is given `OPENAI_BASE_URL` and `ELEVENLABS_BASE_URL` pointing there, with the turn's
   token where each key was; the scripts read both variables and default to the real addresses
   elsewhere. The two keys stay in the service process, like the Anthropic key, and the proxy
   refuses a provider the service holds no key for.
2. **Every billed response is metered from what it says.** A message from its usage; a picture
   from its usage; a sound from its `character-cost` header. Requests that are not billed (a
   model list, a token count) are passed on unmetered.
3. **Units become dollars by the providers' published rates, kept in `chat/prices.ts`.** Anthropic
   is priced by the model the response names, with a cache write for the hour at twice input,
   fast mode at twice the rates, and Haiku 5.5's long-prompt rates past 100K tokens. OpenAI is
   priced by the request's image model. A model a table does not know is priced as the dearest it
   does. An ElevenLabs credit's price depends on the owner's plan, so it is a variable,
   `ELEVENLABS_USD_PER_CREDIT`, and the overage rate when unset.
4. **A response that does not say what it billed is still counted.** A picture cut off before its
   usage is counted as a high-quality square image for each one asked for; a sound without the
   header at the old estimate. Both are logged.
5. **The cap now stops generation too.** Each script request asks the turn's gate first, so a turn
   at the cap is refused its next picture or sound as it is its next message. Keeping takes no
   longer adds to the meter.

## Consequences

- The meter matches the bills to the providers' own units; only the rates are the studio's to
  keep current. A rate change means an edit to `chat/prices.ts`, and a new image model a row.
- No key at all is in the agent's shell.
- A plan bought at a different price per credit needs `ELEVENLABS_USD_PER_CREDIT` set, or sounds
  are counted a little high.
- A script run outside the studio is unchanged: it reads its key and the real address.

## Alternatives considered

- **Read the providers' cost reports.** Anthropic's cost API, OpenAI's costs endpoint and
  ElevenLabs's usage analytics give dollars, but by day and account, after the fact, with admin
  keys. They cannot stop a turn, and cannot say which draft spent what.
- **Have the scripts write each response's usage beside the take.** No change to the proxy, but
  the agent can write those files, and the keys stay in its shell.
