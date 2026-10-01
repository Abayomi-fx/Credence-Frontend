import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import AmountInput from './AmountInput';

const meta: Meta<typeof AmountInput> = {
  title: 'Components/Forms/AmountInput',
  component: AmountInput,
  tags: ['autodocs'],
  argTypes: {
    onChange: { action: 'changed' },
    onValidityChange: { action: 'validityChanged' },
  },
  args: {
    value: '',
    balance: 1000,
    currencyLabel: 'USDC',
  },
}

export default meta
type Story = StoryObj<typeof AmountInput>

export const Default: Story = {
  args: {
    value: '',
  },
}

export const Filled: Story = {
  args: {
    value: '500.00',
  },
}

export const OverBalance: Story = {
  args: {
    value: '1500.00',
    balance: 1000,
  },
}

export const Error: Story = {
  args: {
    value: '5.00',
    error: 'Minimum bond is 10 USDC',
  },
}

export const Disabled: Story = {
  args: {
    value: '100.00',
    disabled: true,
  },
}

export const Loading: Story = {
  args: {
    isLoading: true,
  },
}

/**
 * Loading must not destroy what the user already typed. The field is disabled
 * and `aria-busy` is set, but the amount stays on screen.
 */
export const LoadingWhileCommitted: Story = {
  name: 'Loading while a value is committed',
  args: {
    value: '425.75',
    balance: 1000,
    isLoading: true,
  },
}

/**
 * A failed balance fetch yields a non-finite balance. Max and every preset are
 * disabled rather than enabling a write of `"NaN"` into the field.
 */
export const BalanceUnavailable: Story = {
  name: 'Balance unavailable (non-finite)',
  args: {
    value: '100.00',
    balance: Number.NaN,
    presets: [100, 500],
  },
  parameters: {
    docs: {
      description: {
        story:
          'A `NaN` balance is clamped to 0, which disables Max and every preset instead of letting `NaN.toFixed(2)` reach `onChange`.',
      },
    },
  },
}

export const DuplicateAndInvalidPresets: Story = {
  name: 'Duplicate and invalid presets',
  args: {
    value: '100.00',
    balance: 1000,
    presets: [100, 100, Number.NaN, Number.POSITIVE_INFINITY, -50, 500],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Non-finite and negative presets are dropped and duplicates collapse, so no chip can emit `"NaN"` or trigger a React duplicate-key warning.',
      },
    },
  },
}

// --- Max request failure states -------------------------------------------
// `onMaxRequest` was previously undocumented in this meta set, so none of the
// loading / error / stale / permission states could be reached or reviewed.

/**
 * Deterministic Max harness.
 *
 * Fails the first `failures` attempts, then resolves `result`. `outcome` picks
 * the rejection shape so each documented bucket is reachable by hand: press
 * Max, then Retry.
 */
function MaxFailureHarness({
  outcome,
  failures,
  value,
  balance,
}: {
  outcome: 'error' | 'permission' | 'stale';
  failures: number;
  value: string;
  balance: number;
}) {
  const [amount, setAmount] = React.useState(value);
  const attempts = React.useRef(0);

  const onMaxRequest = React.useCallback(async () => {
    attempts.current += 1;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    if (attempts.current <= failures) {
      if (outcome === 'permission') {
        throw Object.assign(new Error('wallet scope revoked'), { name: 'PermissionError' });
      }
      if (outcome === 'stale') {
        throw Object.assign(new Error('balance snapshot expired'), { name: 'StaleDataError' });
      }
      throw new TypeError('Failed to fetch');
    }
    return balance;
  }, [balance, failures, outcome]);

  return (
    <AmountInput
      value={amount}
      onChange={setAmount}
      balance={balance}
      onMaxRequest={onMaxRequest}
      presets={[100, 500]}
    />
  );
}

const maxFailureArgs = { value: '250.00', balance: 1000, args: {} };

export const MaxNetworkError: Story = {
  ...maxFailureArgs,
  name: 'Max failed (network, retryable)',
  render: () => <MaxFailureHarness outcome="error" failures={1} {...maxFailureArgs} />,
};

export const MaxPermissionDenied: Story = {
  ...maxFailureArgs,
  name: 'Max failed (permission)',
  render: () => <MaxFailureHarness outcome="permission" failures={1} {...maxFailureArgs} />,
};

export const MaxStale: Story = {
  ...maxFailureArgs,
  name: 'Max failed (stale data)',
  render: () => <MaxFailureHarness outcome="stale" failures={1} {...maxFailureArgs} />,
};

/**
 * Fail once, then succeed. Click Max, then Retry: the control re-enters
 * loading and the banner clears on success. The amount entered beforehand is
 * never destroyed by the failure.
 */
export const MaxRetryAfterError: Story = {
  ...maxFailureArgs,
  name: 'Retry after error recovers',
  render: () => <MaxFailureHarness outcome="error" failures={1} {...maxFailureArgs} />,
};

export const BelowMin: Story = {
  name: 'Below minimum',
  args: {
    value: '5.00',
    balance: 1000,
    min: 10,
  },
  render: function BelowMinInteractive(args) {
    const [value, setValue] = React.useState(args.value);
    return <AmountInput {...args} value={value} onChange={setValue} />;
  },
};
