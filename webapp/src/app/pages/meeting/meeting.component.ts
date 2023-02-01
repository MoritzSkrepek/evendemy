import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidatorFn, Validators } from '@angular/forms';

import { Store } from '@ngrx/store';
import * as FileSaver from 'file-saver';
import { combineLatest, Subscription } from 'rxjs';

import { AppState } from '../../appState';
import { Step } from '../../components/breadcrump/breadcrump.component';
import { EditorComponent } from '../../components/editor/editor.component';
import { Comment } from '../../model/comment';
import { Meeting } from '../../model/meeting';
import { MeetingUser } from '../../model/meeting_user';
import { User } from '../../model/user';
import { AuthenticationService } from '../../services/authentication.service';
import { MeetingService } from '../../services/meeting.service';
import { TagsService } from '../../services/tags.service';
import { MeetingUtil } from './meeting.util';
import { first } from 'rxjs/operators';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfigService } from '../../services/config.service';


export function requiredIfNotAnIdea(isIdea: boolean): ValidatorFn {
  return (control: AbstractControl): {[key: string]: any} | null => {
    if (isIdea === null || isIdea === undefined || isIdea === true) {
      return null;
    }
    return control.value ? null : {'required': {value: control.value}};
  };
}

@Component({
  selector: 'evendemy-meeting',
  templateUrl: './meeting.component.html',
  styleUrls: ['./meeting.component.scss']
})
export class MeetingComponent implements OnInit, OnDestroy {
  isNew: boolean;
  subscribe: Subscription;
  meeting: Meeting;
  potentialAttendees: MeetingUser[] = new Array<MeetingUser>();
  isEditable = false;
  userHasAccepted = false;
  userHasFinished = false;
  randomizedNumber = Math.floor(Math.random() * 10000);
  listView = false;
  allTags = [];
  formGroup: FormGroup;
  steps: Step[] = [];
  
  imageFolder = this.configService.config.meeting_image_folder;
  tmpImgData: any;

  users: User[] = [];
  editorContent = "";

  constructor(
    private authService: AuthenticationService,
     private meetingService: MeetingService,
     private route: ActivatedRoute,
    private router: Router,
    private store: Store<AppState>,
    private configService: ConfigService<any>,
    private tagsService: TagsService,
    private formBuilder: FormBuilder) {
  }

  ngOnInit() {
    this.formGroup = this.formBuilder.group({
      title: '',
      shortDescription: '',
      courseOrEvent: '',
      date: '',
      startTime: '',
      endTime: '',
      location: '',
      costCenter: ''
    });

    this.subscribe = combineLatest([this.route.url, this.route.params]).subscribe(([url, params]) => {
      const mid = params['mid'];
      const isIdea = url[0].toString() === 'idea';

      if (mid !== undefined) {
        this.initForExistingMeeting(mid);
      } else {
        this.initForCreation(isIdea);
      }
    });

    this.store.select('users').subscribe( res => this.users = res);

    this.tagsService.getAllTags().subscribe((tags: string[]) => {
      this.allTags = tags;
    });
  }

  ngOnDestroy() {
    this.subscribe.unsubscribe();
  }

  updateValidators(meeting) {
    if (!meeting) {
      return;
    }

    this.date.setValidators([
      Validators.pattern(/^\s*(3[01]|[12][0-9]|0?[1-9])\.(1[012]|0?[1-9])\.((?:19|20)\d{2})\s*$/g),
      requiredIfNotAnIdea(meeting.isIdea)
    ]);
    this.startTime.setValidators([
      Validators.pattern(/(0?[0-9]|[1][0-9]|2[0-4]):([0-4][0-9]|5[0-9])/g),
      requiredIfNotAnIdea(meeting.isIdea)
    ]);
    this.endTime.setValidators([
      Validators.pattern(/(0?[0-9]|[1][0-9]|2[0-4]):([0-4][0-9]|5[0-9])/g),
      requiredIfNotAnIdea(meeting.isIdea)
    ]);

    this.location.setValidators([
      requiredIfNotAnIdea(meeting.isIdea)
    ]);

    this.date.updateValueAndValidity();
    this.startTime.updateValueAndValidity();
    this.endTime.updateValueAndValidity();
    this.location.updateValueAndValidity();
  }

  get date() {
    return this.formGroup.get('date');
  }

  get startTime() {
    return this.formGroup.get('startTime');
  }

  get endTime() {
    return this.formGroup.get('endTime');
  }

  get title() {
    return this.formGroup.get('title');
  }

  get shortDescription() {
    return this.formGroup.get('shortDescription');
  }

  get courseOrEvent() {
    return this.formGroup.get('courseOrEvent');
  }

  get location() {
    return this.formGroup.get('location');
  }

  get costCenter() {
    return this.formGroup.get('costCenter');
  }

  private initForCreation(isIdea) {
    this.isNew = true;

    this.meeting = new Meeting();
    this.courseOrEvent.patchValue('event');
    this.meeting.numberOfAllowedExternals = 0;
    this.meeting.isIdea = isIdea;

    this.isEditable = true;
    this.editorContent = '';

    this.steps = [
      {href: this.meeting.isIdea ? 'ideas' : 'meetings', title: this.meeting.isIdea ? 'Ideas' : 'Meetings'},
      {title: 'new'}
    ];
  }

  public editorChanged(text: string){
    this.editorContent = text;
  }

  public initForExistingMeeting(mid: string) {
    this.isNew = false;

    this.loadMeeting(mid);
    this.loadPotentialAttendees(mid);
  }

  loadMeeting(mid) {
    this.meetingService.getMeeting(mid).pipe(first()).subscribe((meeting) => {
      this.meeting = meeting;
      this.courseOrEvent.patchValue(this.meeting.courseOrEvent);
      this.editorContent = this.meeting.description;
      this.isEditable = this.authService.getLoggedInUsername() === this.meeting.username;
    
      this.formGroup.patchValue({
        title: this.meeting.title,
        shortDescription: this.meeting.shortDescription,
        courseOrEvent: this.meeting.courseOrEvent,
        date: MeetingUtil.dateToString(this.meeting.date),
        startTime: this.meeting.startTime,
        endTime: this.meeting.endTime,
        location: this.meeting.location,
        costCenter: this.meeting.costCenter});

      this.steps = [
        {href: this.meeting.isIdea ? 'ideas' : 'meetings', title: this.meeting.isIdea ? 'Ideas' : 'Meetings'},
        {title: this.meeting.title }
      ];
    });
  }

  loadPotentialAttendees(mid) {
    this.userHasAccepted = false;
    this.userHasFinished = false;

    this.meetingService.getAllAttendingUsers(mid).subscribe((result) => {
      this.potentialAttendees = result;
      const attendee = this.potentialAttendees.find(a => a.username === this.authService.getLoggedInUsername());
      if (attendee) {
        this.userHasAccepted = true;
        this.userHasFinished = attendee.tookPart;
      }
    });
  }

  onSaveMeeting() {
    if (this.meeting.mid !== undefined && this.meeting.mid !== null) {
      this.updateMeeting();
    } else {
      this.createMeeting();
    }
  }

  createMeetingObject(): Meeting {
    var meeting = new Meeting();
    meeting.mid = this.meeting.mid;
    meeting.title = this.title.value;
    meeting.shortDescription = this.shortDescription.value;
    meeting.courseOrEvent = this.courseOrEvent.value;
    meeting.description = this.editorContent;
    meeting.date = MeetingUtil.stringToDate(this.date.value);
    meeting.startTime = this.startTime.value;
    meeting.endTime = this.endTime.value;
    meeting.location = this.location.value;
    meeting.costCenter = this.costCenter.value;
    return meeting;
  }

  createMeeting() {
    var meeting = this.createMeetingObject();
    this.meetingService.createMeeting(meeting).pipe(first()).subscribe((result: Meeting) => {
      this.meeting = result;
      this.uploadImage(this.meeting.mid);
      this.navigateBack();
    });
  }

  updateMeeting() {
    this.uploadImage(this.meeting.mid);
    var meeting = this.createMeetingObject();
    this.meetingService.updateMeeting(meeting).pipe(first()).subscribe((result) => {
      this.navigateBack();
    });
  }

  private navigateBack() {
    if (this.meeting.isIdea) {
      this.router.navigate(['/ideas']);
      return;
    }
    this.router.navigate(['/meetings']);
  }

  uploadImage(mid: number) {
    if (this.tmpImgData) {
      const result = {
        mid: mid,
        data: this.tmpImgData
      };
      this.meetingService.addImage(mid, result).pipe(first()).subscribe((img_result) => {});
    }
  }

  onDeleteMeeting() {
    this.meetingService.deleteMeeting(this.meeting.mid).pipe(first()).subscribe((result) => {
      this.router.navigate(['/meetings']);
    });
  }

  createCopy() {
    const meeting = { ... this.meeting };
    meeting.mid = null;
    meeting.comments = [];
    meeting.creationDate = null;
    meeting.username = null;
    return meeting;
  }

  onCopy() {
    this.meeting = this.createCopy();
    this.potentialAttendees = [];
    this.isNew = true;
    this.userHasAccepted = false;
    this.userHasFinished = false;
  }

  onMakeAMeeting() {
    this. meeting = this.createCopy();
    this.meeting.isIdea = false;

    this.potentialAttendees = [];
    this.isNew = true;
    this.userHasAccepted = false;
    this.userHasFinished = false;
  }

  onAcceptMeeting(external) {
    this.meetingService.attendMeeting(this.meeting.mid, this.authService.getLoggedInUsername(), external)
      .pipe(first()).subscribe((result) => {
        this.userHasAccepted = true;
        this.userHasFinished = false;
        this.loadPotentialAttendees(this.meeting.mid);
    });
  }

  onRejectMeeting() {
    this.meetingService.rejectAttendingMeeting(this.meeting.mid, this.authService.getLoggedInUsername())
      .pipe(first()).subscribe((result) => {
        this.userHasAccepted = false;
        this.userHasFinished = false;
        this.loadPotentialAttendees(this.meeting.mid);
    });
  }

  onRemoveAttendee(user: User) {
    this.meetingService.rejectAttendingMeeting(this.meeting.mid, user.username)
      .pipe(first()).subscribe((result) => {
        this.loadPotentialAttendees(this.meeting.mid);
    });
  }

  onHasTakenPart(attendee: MeetingUser) {
    if (attendee && !attendee.tookPart) {
      const foundedAttendee = this.potentialAttendees.find(p => p.username === attendee.username);
      foundedAttendee.tookPart = true;
      if (foundedAttendee.username === this.authService.getLoggedInUsername()) {
        this.userHasFinished = true;
      }
      this.meetingService.confirmAttendeeToMeeting(this.meeting.mid, foundedAttendee.username).pipe(first()).subscribe((result) => { });
    }
  }

  onAddComment(comment: Comment) {
    this.meetingService.addComment(this.meeting.mid, comment).pipe(first()).subscribe((meeting) => {
      this.meeting.comments = meeting.comments;
    });
  }

  downloadCSV() {
    const csv = MeetingUtil.generateCSV(this.potentialAttendees, this.users);
    const blob = new Blob([csv], { type: 'text/csv' });
    FileSaver.saveAs(blob, 'attendees-for-meeting-' + this.meeting.mid + '.csv');
  }

  onGetCalendar() {
    this.meetingService.getCalendar(this.meeting.mid).pipe(first()).subscribe( (cal: any) => {
      const blob = new Blob([cal.content], { type: 'text/calendar;charset=utf-8' });
      FileSaver.saveAs(blob, 'calendar-for-meeting-' + this.meeting.mid + '.ics');
    });
  }

  setTemporaryImage(img: any) {
    this.tmpImgData = img;
  }

  getUser(username: string) {
    const res = this.users.find( user => user.username === username);
    return res ? res : username;
  }

  getAttendedNumber() {
    return this.potentialAttendees.filter( p => p.tookPart === true).length;
  }

  getNotAttendedNumber() {
    return this.potentialAttendees.filter( p => p.tookPart !== true).length;
  }

  hasValidDateAndTime() {
    return MeetingUtil.hasValidDateAndTime(this.meeting);
  }

  isInThePast() {
    return MeetingUtil.isInThePast(this.meeting);
  }

  isInThePastOrToday() {
    return MeetingUtil.isInThePastOrToday(this.meeting);
  }

  hasEveryoneTookPart() {
    return this.potentialAttendees.length === this.getAttendedNumber();
  }

  checkboxChanged() {
    this.meeting.numberOfAllowedExternals === 0 ? this.meeting.numberOfAllowedExternals = 1 : this.meeting.numberOfAllowedExternals = 0;
  }

  numberOfParticipants() {
    const externals = this.potentialAttendees.filter(p => p.externals.length > 0);
    return this.potentialAttendees.length + externals.length;
  }

  onTagSelect(tag: string) {
    this.router.navigate(['/meetings', this.courseOrEvent.value], {queryParams: {tags: tag}});
  }

  onAddingTag() {
    this.meeting.tags = this.meeting.tags.map(tag => tag.toLowerCase()).map(tag => tag.replace(/ /g, '-'));
  }

  getStatus() {
    return MeetingUtil.mapStatus(this.isNew,  this.userHasAccepted, this.userHasFinished);
  }
}
