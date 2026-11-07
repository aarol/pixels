<script lang="ts">
  let {
    imageName,
    onReset,
  }: {
    imageName: string
    onReset: () => void
  } = $props()

  let dialog: HTMLDialogElement
  let confirmingReset = $state(false)

  function onToggle(e: ToggleEvent) {
    if (e.newState === 'closed') {
      confirmingReset = false
    }
  }

  function onResetClick() {
    if (!confirmingReset) {
      confirmingReset = true
      return
    }
    onReset()
    confirmingReset = false
    dialog.hidePopover()
  }
</script>

<button class="menu-btn" aria-label="Toggle menu" popovertarget="app-menu">
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      d="M4 6h16M4 12h16M4 18h16"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="square"
    />
  </svg>
</button>

<dialog id="app-menu" popover bind:this={dialog} ontoggle={onToggle}>
  <div class="dialog-content">
    <div class="image-name">{imageName}</div>
    <button class="reset-btn" onclick={onResetClick}>
      {confirmingReset ? 'Are you sure?' : 'Reset progress'}
    </button>
  </div>
</dialog>

<style>
  button {
    font: inherit;
    border: 0;
    border-radius: 0;
    margin: 0;
    padding: 0;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
  }

  .menu-btn {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    color: #111;
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
  }

  .menu-btn:active {
    background: #eee;
  }

  dialog {
    position: fixed;
    inset: 16px 68px auto auto;
    margin: 0;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: #fff;
    color: #111;
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
  }

  @media (min-width: 701px) {
    .menu-btn {
      top: auto;
      bottom: 16px;
      right: 16px;
    }

    dialog {
      inset: auto 68px 16px auto;
    }
  }

  .dialog-content {
    padding: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .image-name {
    font-size: 14px;
    font-weight: 600;
  }

  .reset-btn {
    width: 132px;
    height: 32px;
    background: #dc2626;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }

  .reset-btn:hover {
    background: #b91c1c;
  }

  .reset-btn:active {
    background: #991b1b;
  }
</style>
