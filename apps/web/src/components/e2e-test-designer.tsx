import React, { useState, useCallback, useEffect } from "react";
import { Trash2, Plus, ArrowUp, ArrowDown, Copy } from "lucide-react";
import { E2EStepGenerator } from "./e2e-step-generator";
import { useNotification } from "./notification-provider";

interface TestStep {
  id: string;
  instruction: string;
  order: number;
}

interface TestDefinition {
  name: string;
  description: string;
  domain: string;
  steps: TestStep[];
  retryCount: number;
  strictnessLevel: "low" | "medium" | "high";
  visualRegressionEnabled: boolean;
  autoApproveBaseline: boolean;
  cronSchedule?: string;
  notificationConfig?: {
    emailEnabled: boolean;
    emailAddresses: string[];
    slackEnabled: boolean;
    slackWebhook?: string;
    webhookEnabled: boolean;
    webhookUrl?: string;
    notifyOnFailure: boolean;
    notifyOnSuccess: boolean;
  };
}

export interface E2ETestDesignerProps {
  testId?: string;
  initialTest?: Partial<TestDefinition>;
  onSave: (test: TestDefinition) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

export const E2ETestDesigner: React.FC<E2ETestDesignerProps> = ({
  testId,
  initialTest,
  onSave,
  onCancel,
  isLoading = false,
}) => {
  const { error: notifyError } = useNotification();
  const [test, setTest] = useState<TestDefinition | null>(null);
  const [loading, setLoading] = useState(!!testId);
  const [currentStepInput, setCurrentStepInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Helper to safely update test state
  const updateTest = useCallback((updates: (prev: TestDefinition) => TestDefinition) => {
    setTest((prev) => (prev ? updates(prev) : prev));
  }, []);

  // Helper to safely update notification config
  const updateNotificationConfig = useCallback((updates: (prev: NonNullable<TestDefinition['notificationConfig']>) => Partial<NonNullable<TestDefinition['notificationConfig']>>) => {
    updateTest((prev) => ({
      ...prev,
      notificationConfig: {
        emailEnabled: prev.notificationConfig?.emailEnabled || false,
        emailAddresses: prev.notificationConfig?.emailAddresses || [],
        slackEnabled: prev.notificationConfig?.slackEnabled || false,
        slackWebhook: prev.notificationConfig?.slackWebhook || "",
        webhookEnabled: prev.notificationConfig?.webhookEnabled || false,
        webhookUrl: prev.notificationConfig?.webhookUrl || "",
        notifyOnFailure: prev.notificationConfig?.notifyOnFailure ?? true,
        notifyOnSuccess: prev.notificationConfig?.notifyOnSuccess || false,
        ...updates(prev.notificationConfig || {
          emailEnabled: false,
          emailAddresses: [],
          slackEnabled: false,
          webhookEnabled: false,
          notifyOnFailure: true,
          notifyOnSuccess: false,
        }),
      },
    }));
  }, [updateTest]);

  useEffect(() => {
    if (initialTest) {
      setTest(initialTest as TestDefinition);
      setLoading(false);
      return;
    }

    if (testId) {
      const fetchTest = async () => {
        try {
          const response = await fetch(`http://localhost:3100/api/e2e/tests/${testId}`);
          if (!response.ok) throw new Error("Failed to fetch test");
          const data = await response.json();
          console.log("[E2E Designer] API Response:", data);
          
          // Transform the data to match TestDefinition structure
          let stepsArray: any[] = [];
          
          // Try to get steps from either location
          if (Array.isArray(data.steps) && data.steps.length > 0) {
            stepsArray = data.steps;
          } else if (Array.isArray((data.definition as any)?.steps) && (data.definition as any).steps.length > 0) {
            stepsArray = (data.definition as any).steps;
          }
          
          // Transform steps to TestStep format if they're strings
          const transformedSteps: TestStep[] = stepsArray.map((step: any, index: number) => {
            if (typeof step === "string") {
              // Step is just a string instruction
              return {
                id: `step-${index}-${Date.now()}`,
                instruction: step,
                order: index,
              };
            } else if (step.instruction) {
              // Step is already an object with instruction
              return {
                id: step.id || `step-${index}-${Date.now()}`,
                instruction: step.instruction,
                order: step.order ?? index,
              };
            }
            return {
              id: `step-${index}-${Date.now()}`,
              instruction: "",
              order: index,
            };
          });
          
          const transformedTest: TestDefinition = {
            name: data.name || "",
            description: data.description || "",
            domain: data.domain || "",
            steps: transformedSteps,
            retryCount: typeof data.retryCount === "number" ? data.retryCount : 2,
            strictnessLevel: data.strictnessLevel || "high",
            visualRegressionEnabled: data.visualRegressionEnabled !== false,
            autoApproveBaseline: data.autoApproveBaseline || false,
            cronSchedule: data.cronSchedule || undefined,
            notificationConfig: data.notificationConfig || {
              emailEnabled: false,
              emailAddresses: [],
              slackEnabled: false,
              webhookEnabled: false,
              notifyOnFailure: true,
              notifyOnSuccess: false,
            },
          };
          
          console.log("[E2E Designer] Loaded test:", { name: transformedTest.name, stepsCount: transformedTest.steps.length, steps: transformedTest.steps });
          setTest(transformedTest);
          } catch (error) {
            console.error("Error fetching test:", error);
            notifyError("Failed to load test", "Could not retrieve the test details");
          } finally {
            setLoading(false);
          }
      };

      fetchTest();
    } else {
      setTest({
        name: "",
        description: "",
        domain: "",
        steps: [],
        retryCount: 2,
        strictnessLevel: "high",
        visualRegressionEnabled: true,
        autoApproveBaseline: false,
        notificationConfig: {
          emailEnabled: false,
          emailAddresses: [],
          slackEnabled: false,
          webhookEnabled: false,
          notifyOnFailure: true,
          notifyOnSuccess: false,
        },
      });
      setLoading(false);
    }
  }, [testId, initialTest]);

  const addStep = useCallback(() => {
    if (!currentStepInput.trim()) return;

    updateTest((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        {
          id: `step-${Date.now()}`,
          instruction: currentStepInput.trim(),
          order: prev.steps.length,
        },
      ],
    }));
    setCurrentStepInput("");
  }, [currentStepInput, updateTest]);

  const removeStep = useCallback((id: string) => {
    updateTest((prev) => ({
      ...prev,
      steps: prev.steps
        .filter((s) => s.id !== id)
        .map((s, i) => ({ ...s, order: i })),
    }));
  }, [updateTest]);

  const moveStep = useCallback((id: string, direction: "up" | "down") => {
    updateTest((prev) => {
      const index = prev.steps.findIndex((s) => s.id === id);
      if ((direction === "up" && index === 0) || (direction === "down" && index === prev.steps.length - 1)) {
        return prev;
      }

      const newSteps = [...prev.steps];
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      [newSteps[index], newSteps[swapIndex]] = [newSteps[swapIndex], newSteps[index]];

      return {
        ...prev,
        steps: newSteps.map((s, i) => ({ ...s, order: i })),
      };
    });
  }, [updateTest]);

  const updateStep = useCallback((id: string, instruction: string) => {
    updateTest((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === id ? { ...s, instruction } : s)),
    }));
  }, [updateTest]);

  const duplicateStep = useCallback((id: string) => {
    updateTest((prev) => {
      const step = prev.steps.find((s) => s.id === id);
      if (!step) return prev;

      return {
        ...prev,
        steps: [
          ...prev.steps,
          {
            ...step,
            id: `step-${Date.now()}`,
            order: prev.steps.length,
          },
        ],
      };
    });
  }, [updateTest]);

  const handleGeneratedSteps = useCallback((generatedSteps: Array<{ instruction: string }>) => {
    updateTest((prev) => {
      if (!prev) return prev;
      const currentSteps = Array.isArray(prev.steps) ? prev.steps : [];
      return {
        ...prev,
        steps: [
          ...currentSteps,
          ...generatedSteps.map((step, idx) => ({
            id: `step-${Date.now()}-${idx}`,
            instruction: step.instruction,
            order: currentSteps.length + idx,
          })),
        ],
      };
    });
  }, [updateTest]);

  const handleSave = async () => {
    if (!test) return;
    if (!test.name.trim()) {
      notifyError("Test name is required", "Please provide a name for your test");
      return;
    }

    if (!test.domain.trim()) {
      notifyError("Domain is required", "Please specify a domain for this test");
      return;
    }

    if (test.steps.length === 0) {
      notifyError("Add at least one step", "Your test must contain at least one step");
      return;
    }

    try {
      setIsSaving(true);
      await onSave(test);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading || !test) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-card rounded-lg shadow border border-border">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-card rounded-lg shadow border border-border">
      <h1 className="text-3xl font-bold mb-6 text-foreground">{testId ? "Edit Test" : "Create E2E Test"}</h1>

      {/* Basic Info Section */}
      <div className="mb-8 pb-8 border-b border-border">
        <h2 className="text-xl font-semibold mb-4 text-foreground">Test Information</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Test Name *</label>
            <input
              type="text"
              value={test?.name || ""}
              onChange={(e) => updateTest((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., Login Flow"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Strictness Level</label>
            <select
              value={test?.strictnessLevel || "high"}
              onChange={(e) =>
                updateTest((prev) => ({
                  ...prev,
                  strictnessLevel: e.target.value as "low" | "medium" | "high",
                }))
              }
              className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-1">Description</label>
          <textarea
            value={test?.description || ""}
            onChange={(e) => updateTest((prev) => ({ ...prev, description: e.target.value }))}
            className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="What does this test verify?"
            rows={3}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-1">Domain *</label>
          <input
            type="text"
            value={test?.domain || ""}
            onChange={(e) => updateTest((prev) => ({ ...prev, domain: e.target.value }))}
            className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="e.g., example.com"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Retry Count</label>
            <input
              type="number"
              min="0"
              max="5"
              value={test?.retryCount || 2}
              onChange={(e) =>
                updateTest((prev) => ({ ...prev, retryCount: parseInt(e.target.value) || 0 }))
              }
              className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <label className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              checked={test?.visualRegressionEnabled || false}
              onChange={(e) => updateTest((prev) => ({ ...prev, visualRegressionEnabled: e.target.checked }))}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium text-foreground">Visual Regression</span>
          </label>

          <label className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              checked={test?.autoApproveBaseline || false}
              onChange={(e) => updateTest((prev) => ({ ...prev, autoApproveBaseline: e.target.checked }))}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium text-foreground">Auto-Approve Baseline</span>
          </label>
        </div>
      </div>

      {/* Steps Section */}
      <div className="mb-8 pb-8 border-b border-border">
        <h2 className="text-xl font-semibold mb-4 text-foreground">Test Steps *</h2>

        {/* AI Step Generator */}
        <div className="mb-6 p-4 bg-muted/50 rounded-lg border border-border">
          <E2EStepGenerator
            prompt={test?.description || ""}
            onGeneratedSteps={handleGeneratedSteps}
            isLoading={loading}
          />
        </div>

        <div className="space-y-3 mb-4">
          {(test?.steps?.length ?? 0) === 0 ? (
            <p className="text-muted-foreground text-sm italic">No steps added yet. Add your first step below.</p>
          ) : (
            test?.steps?.map((step, index) => (
              <div key={step.id} className="flex gap-2 items-start bg-muted p-3 rounded-md border border-border">
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => moveStep(step.id, "up")}
                    disabled={index === 0}
                    className="p-1 hover:bg-accent text-muted-foreground disabled:opacity-50"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    onClick={() => moveStep(step.id, "down")}
                    disabled={index === (test?.steps.length || 0) - 1}
                    className="p-1 hover:bg-accent text-muted-foreground disabled:opacity-50"
                  >
                    <ArrowDown size={16} />
                  </button>
                </div>

                <div className="flex-1">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Step {index + 1}</div>
                  <input
                    type="text"
                    value={step.instruction}
                    onChange={(e) => updateStep(step.id, e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Natural language instruction, e.g., 'Click the login button'"
                  />
                </div>

                <div className="flex gap-1">
                  <button
                    onClick={() => duplicateStep(step.id)}
                    className="p-2 hover:bg-primary/20 text-primary rounded"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => removeStep(step.id)}
                    className="p-2 hover:bg-red-500/20 text-red-500 rounded"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={currentStepInput}
            onChange={(e) => setCurrentStepInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && addStep()}
            className="flex-1 px-3 py-2 border border-border rounded-md bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Enter a test step (natural language)..."
          />
          <button
            onClick={addStep}
            disabled={!currentStepInput.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            <Plus size={16} />
            Add Step
          </button>
        </div>
      </div>

      {/* Scheduling Section */}
      <div className="mb-8 pb-8 border-b border-border">
        <h2 className="text-xl font-semibold mb-4 text-foreground">Schedule</h2>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Cron Schedule (Optional)</label>
          <input
            type="text"
            value={test?.cronSchedule || ""}
            onChange={(e) => updateTest((prev) => ({ ...prev, cronSchedule: e.target.value }))}
            className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="e.g., 0 */6 * * * (every 6 hours)"
          />
          <p className="text-xs text-muted-foreground mt-1">Leave empty for manual execution only</p>
        </div>
      </div>

      {/* Notifications Section */}
      <div className="mb-8 pb-8 border-b border-border">
        <h2 className="text-xl font-semibold mb-4 text-foreground">Notifications</h2>

        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={test?.notificationConfig?.emailEnabled || false}
              onChange={(e) =>
                updateNotificationConfig((prev) => ({
                  ...prev,
                  emailEnabled: e.target.checked,
                }))
              }
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium text-foreground">Email Notifications</span>
          </label>

          {test?.notificationConfig?.emailEnabled && (
            <div className="ml-6">
              <input
                type="text"
                value={test.notificationConfig?.emailAddresses?.join(", ") || ""}
                onChange={(e) =>
                  updateNotificationConfig((prev) => ({
                    ...prev,
                    emailAddresses: e.target.value.split(",").map((s) => s.trim()),
                  }))
                }
                className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="email1@example.com, email2@example.com"
              />
            </div>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={test?.notificationConfig?.slackEnabled || false}
              onChange={(e) =>
                updateNotificationConfig((prev) => ({
                  ...prev,
                  slackEnabled: e.target.checked,
                }))
              }
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium text-foreground">Slack Notifications</span>
          </label>

          {test?.notificationConfig?.slackEnabled && (
            <div className="ml-6">
              <input
                type="text"
                value={test.notificationConfig?.slackWebhook || ""}
                onChange={(e) =>
                  updateNotificationConfig((prev) => ({
                    ...prev,
                    slackWebhook: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="https://hooks.slack.com/services/..."
              />
            </div>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={test?.notificationConfig?.webhookEnabled || false}
              onChange={(e) =>
                updateNotificationConfig((prev) => ({
                  ...prev,
                  webhookEnabled: e.target.checked,
                }))
              }
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium text-foreground">Webhook Notifications</span>
          </label>

          {test?.notificationConfig?.webhookEnabled && (
            <div className="ml-6">
              <input
                type="text"
                value={test.notificationConfig?.webhookUrl || ""}
                onChange={(e) =>
                  updateNotificationConfig((prev) => ({
                    ...prev,
                    webhookUrl: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 border border-border rounded-md bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="https://your-webhook.com/endpoint"
              />
            </div>
          )}

          <div className="flex gap-4 mt-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={test?.notificationConfig?.notifyOnFailure || false}
                onChange={(e) =>
                  updateNotificationConfig((prev) => ({
                    ...prev,
                    notifyOnFailure: e.target.checked,
                  }))
                }
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-foreground">Notify on Failure</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={test?.notificationConfig?.notifyOnSuccess || false}
                onChange={(e) =>
                  updateNotificationConfig((prev) => ({
                    ...prev,
                    notifyOnSuccess: e.target.checked,
                  }))
                }
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-foreground">Notify on Success</span>
            </label>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={isSaving || isLoading}
            className="px-4 py-2 border border-border text-foreground rounded-md hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving || isLoading}
          className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium"
        >
          {isSaving || isLoading ? "Saving..." : "Save Test"}
        </button>
      </div>
    </div>
  );
};

export default E2ETestDesigner;
