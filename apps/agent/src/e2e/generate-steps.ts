export async function generateE2ESteps(
  prompt: string,
  domain?: string,
  learningsContext?: string
): Promise<Array<{ instruction: string }>> {
  if (!prompt.trim()) {
    throw new Error("Prompt is required");
  }

  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not configured");
    }

    // Use Google Generative AI to generate realistic test steps
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are an expert QA automation engineer. Generate clear, simple E2E test steps for a browser automation AI.

${domain ? `Target Domain: ${domain}\n` : ""}
${learningsContext ? `## Context from past successful tests on this domain:\n${learningsContext}\nUse these patterns to write instructions that match the known application structure.\n` : ""}

Requirement: "${prompt}"

IMPORTANT RULES:
- Use simple, direct language - avoid complex sentences
- Each step should be ONE action only
- Use simple verbs: click, fill, type, navigate, wait, verify, check, look for
- Be specific about targets: "Click the Login button" not "Click on what appears to be a login button"
- Keep instructions under 20 words each
- Focus on observable user actions, not internal states

Think about:
1. Navigation: Where should the browser go first?
2. Interactions: What clicks, forms, and selections are needed?
3. Verifications: What text or elements should be visible after each action?

Return ONLY valid JSON array with "instruction" field. Example:
[
  { "instruction": "Navigate to https://example.com" },
  { "instruction": "Click the Login button" },
  { "instruction": "Type user@example.com in the email field" },
  { "instruction": "Click the Submit button" },
  { "instruction": "Verify the Dashboard title is visible" }
]`,
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google API error: ${response.statusText} - ${JSON.stringify(errorData)}`);
    }

    const data = (await response.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const responseText = data.candidates[0]?.content?.parts[0]?.text || "";

    // Parse the response - it should contain JSON
    let parsedSteps: Array<{ instruction: string }> = [];

    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedSteps = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", parseError);
      // Fallback: create a step from the prompt
      parsedSteps = [{ instruction: prompt }];
    }

    // Validate and clean steps
    const cleanedSteps = parsedSteps
      .filter((step) => step && typeof step.instruction === "string" && step.instruction.trim())
      .slice(0, 20) // Limit to 20 steps
      .map((step) => ({
        instruction: step.instruction.trim(),
      }));

    if (cleanedSteps.length === 0) {
      // Fallback if no steps were generated
      cleanedSteps.push({ instruction: prompt });
    }

    return cleanedSteps;
  } catch (error) {
    console.error("Error generating steps:", error);
    throw new Error(`Failed to generate steps: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
