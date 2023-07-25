import type { Session } from "next-auth";
import type { AgentApi } from "./agent-api";
import type { ModelSettings } from "../../types";
import type { MessageService } from "./message-service";
import type { AgentRunModel } from "./agent-run-model";
import { useAgentStore } from "../../stores";
import { isRetryableError } from "../../types/errors";
import AnalyzeTaskWork from "./agent-work/analyze-task-work";
import StartGoalWork from "./agent-work/start-task-work";
import type AgentWork from "./agent-work/agent-work";
import { withRetries } from "../api-utils";
import type { Message } from "../../types/message";
import SummarizeWork from "./agent-work/summarize-work";
import ChatWork from "./agent-work/chat-work";

class AutonomousAgent {
  model: AgentRunModel;
  modelSettings: ModelSettings;
  session?: Session;
  messageService: MessageService;
  api: AgentApi;
  
  
  private completedTasks: number;
  private readonly workLog: AgentWork[];
  private lastConclusion?: () => Promise<void>;

  constructor(
    model: AgentRunModel,
    messageService: MessageService,
    modelSettings: ModelSettings,
    api: AgentApi,
    session?: Session,

  ) {
    this.model = model;
    this.messageService = messageService;
    this.modelSettings = modelSettings;
    this.session = session;
    this.api = api;
    this.workLog = [new StartGoalWork(this)];
    this.completedTasks = 0
  }

  


  async run() {
    this.model.setLifecycle("running");


    // Log data from the agent store
    console.log("Agent Store Data:", useAgentStore.getState());

    const agent = useAgentStore.getState();
    console.log(agent.agent.modelSettings.customMaxLoops);
    

    // If an agent is paused during execution, we need to play work conclusions
    if (this.lastConclusion) {
      await this.lastConclusion();
      this.lastConclusion = undefined;
    }

    this.addTasksIfWorklogEmpty();
    while (this.workLog[0]) {
      // No longer running, dip
      if (this.model.getLifecycle() === "pausing") this.model.setLifecycle("paused");
      if (this.model.getLifecycle() !== "running") return;

      // Get and run the next work item
      const work = this.workLog[0];
      await this.runWork(work, () => this.model.getLifecycle() === "stopped");

      this.workLog.shift();
      if (this.model.getLifecycle() !== "running") {
        this.lastConclusion = () => work.conclude();
      } else {
        await work.conclude();
      }
      if( work.task !== undefined){
        console.log(work.task.status);
        console.log(work.task);
        if(work.task.status === "completed" && work.task.result !== "")
        {
          // this.completedTasks += 1;
          this.completedTasks++;
        }
        
      }
      
      console.log(this.completedTasks);
      
      
      // Increment the completedTasks counter and check if it has reached the maximum
      if (this.completedTasks >= agent.agent.modelSettings.customMaxLoops*2) {
        this.model.setLifecycle("stopped");
      }
      

      

      // Add next thing if available
      const next = work.next();
      if (next) {
        this.workLog.push(next);
      }

      this.addTasksIfWorklogEmpty();
    }

    if (this.model.getLifecycle() === "pausing") this.model.setLifecycle("paused");
    if (this.model.getLifecycle() !== "running") return;

    // Done with everything in the log and all queued tasks
    this.messageService.sendCompletedMessage();
    this.stopAgent();
  }

  /*
   * Runs a provided work object with error handling and retries
   */
  private async runWork(work: AgentWork, shouldStop: () => boolean = () => false) {
    const RETRY_TIMEOUT = 2000;

    await withRetries(
      async () => {
        if (shouldStop()) return;
        await work.run();
      },
      async (e) => {
        const shouldRetry = work.onError?.(e) || true;

        if (!isRetryableError(e)) {
          this.stopAgent();
          return false;
        }

        if (shouldRetry) {
          // Wait a bit before retrying
          useAgentStore.getState().setIsAgentThinking(true);
          await new Promise((r) => setTimeout(r, RETRY_TIMEOUT));
        }

        return shouldRetry;
      }
    );


    useAgentStore.getState().setIsAgentThinking(false);


  }

  

  addTasksIfWorklogEmpty = () => {
    if (this.workLog.length > 0) return;

    
    const currentTask = this.model.getCurrentTask();
    if (currentTask) {
      this.workLog.push(new AnalyzeTaskWork(this, currentTask));
    }
  };

  pauseAgent() {
    this.model.setLifecycle("pausing");
  }

  stopAgent() {
    this.model.setLifecycle("stopped");
    return;
  }

  async summarize() {
    this.model.setLifecycle("running");
    const summarizeWork = new SummarizeWork(this);
    await this.runWork(summarizeWork);
    await summarizeWork.conclude();
    this.model.setLifecycle("stopped");
  }

  async chat(message: string) {
    if (this.model.getLifecycle() == "running") this.pauseAgent();
    let paused = false;
    if (this.model.getLifecycle() == "stopped") {
      paused = true;
      this.model.setLifecycle("pausing");
    }
    const chatWork = new ChatWork(this, message);
    await this.runWork(chatWork);
    await chatWork.conclude();
    if (paused) {
      this.model.setLifecycle("stopped");
    }
  }

  async createTaskMessages(tasks: string[]) {
    const TIMOUT_SHORT = 150;
    const messages: Message[] = [];

    for (const value of tasks) {
      messages.push(this.messageService.startTask(value));
      this.model.addTask(value);
      await new Promise((r) => setTimeout(r, TIMOUT_SHORT));
    }

    return messages;
  }
}

export default AutonomousAgent;
