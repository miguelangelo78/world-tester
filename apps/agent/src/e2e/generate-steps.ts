export async function generateE2ESteps(
  prompt: string
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
                  text: `You are an expert QA automation engineer. Based on the following requirement, generate a list of realistic, executable E2E test steps that an automated test should perform.

Requirement: "${prompt}"

Think about:
1. What pages or screens need to be navigated to
2. What user interactions are needed (clicks, form fills, selections)
3. What assertions or verifications should be done
4. Edge cases or error scenarios if relevant

Return ONLY a valid JSON array of objects with "instruction" field. Each instruction should be a single, clear, actionable step that can be performed by a browser automation tool. Keep instructions concise but specific.

Format:
[
  { "instruction": "Navigate to the homepage" },
  { "instruction": "Click on the login link" },
  { "instruction": "Enter email in the email field" }
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
