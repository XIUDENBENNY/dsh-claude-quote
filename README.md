# dsh-claude-quote

English | [中文](README.zh.md)

Claude Code Desktop–style selection quoting for the DeepSeek Harness (DSH) web and desktop client. Select text in a conversation to reply to that passage, or branch it into a side chat.

> Not affiliated with Anthropic. "Claude-style" only means the interaction and styling follow Claude Code Desktop.

![Floating toolbar over a selection](screenshots/toolbar.png)

## Features

- **Floating toolbar**: select at least 2 characters in a conversation and "Start a side chat | Reply" appears above the selection. When the selection spans more than one message, only the side chat is offered. Enter acts as Reply; Esc dismisses.
- **Reply popover**: 320px wide, shows the quoted passage on top and keeps it highlighted in the conversation.
  - Enter adds the quote and your comment to the prompt as a card
  - Ctrl/⌘ + Enter sends it right away, bypassing the prompt
  - Esc closes it; clicking outside also closes it while the comment is empty
- **Quote cards in the prompt**: 120×120 cards above the prompt. Click to preview the full text, × to remove. Stack several and send them with your message.
- **Sent messages**: quotes inside your message bubble render as a grey block with a bar on the left, the comment below it. Blocks longer than 6 lines are clamped; click to expand.
- **Side chat**: forks the current session (history up to this point), opens it in the right sidebar titled "Side chat · <quote>", and puts the selection into its prompt as a quote. The main conversation is untouched. Once a side chat exists, the button becomes "Send to side chat"; inside a side chat only Reply is offered.
- A single quote is capped at 1500 characters. UI strings are in Chinese and English and follow the DSH language setting.

![Reply popover](screenshots/reply.png)
![Quote card in the prompt](screenshots/composer.png)
![Quote block in a sent message](screenshots/sent.png)
![Side chat](screenshots/sidechat.png)

## Wire format

Same as Claude Code Desktop: quotes reach the model as plain Markdown, so no model-side support is needed.

```
<!-- reply -->
> quoted passage

your comment
```

A quote without a comment uses `<!-- attach -->`. Only these comments at the start of a line are recognized, so mentioning them in prose is not re-rendered.

## Install

Once listed in [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), search for `dsh-claude-quote` in the dsh-market plugin market.

Manual install (local development): clone the repo and add it to your profile's `package.json`:

```json
{
  "dependencies": {
    "dsh-client-ui-claude-quote": "link:/path/to/dsh-claude-quote"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-client-ui-claude-quote"]
    }
  }
}
```

Append to the existing `bundles` list rather than replacing it. Run `pnpm install` in the profile directory (or link the repo as the profile's `node_modules/dsh-client-ui-claude-quote` yourself), then restart DSH. The package's own `cordis.patch.yml` inserts the loader row, so the profile's `cordis.patch.yml` needs no edit. After changing `lib/client.js`, a page reload is enough.

## Compatibility

- Tested on DSH 0.2.1-rc.2 (DSH Desktop, web platform).
- The plugin relies on the conversation DOM (attributes such as `data-chat-node-key`) and on client services such as `uiConversation`, `sidebarRightTabs`, `sessions` and `resources`. These are not a stable public API, so a DSH upgrade may need a follow-up release. Please include your DSH version when filing an issue.

## Development

```
npm test
```

Runs unit tests for the wire format and parsing rules; DSH does not need to be running.

## License

[MIT](LICENSE)
