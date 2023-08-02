import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { MeetingEntity } from './entities/meeting.entity';
import { FindOptionsWhere, Repository, MoreThanOrEqual, LessThan, IsNull, Admin, FindOperator, ArrayContains, And, DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { NotificationAboutMeetingsService } from './notfication-about-meetings.service';
import { BookingEntity } from './entities/booking.entity';
import { CommentEntity } from './entities/comment.entity';
import { UsersService } from 'src/users/users/users.service';
import { CalendarService } from './calendar.service';

class MeetingsFilter {
  showNotAnnounced: boolean;
  showOld: boolean;
  showNew: boolean; 
  username?: string; 
  courseOrEvent?: 'course' | 'event';
  idea: boolean;
  tags: string[];
}

@Injectable()
export class MeetingsService {

  constructor(
    @InjectRepository(MeetingEntity)
    private meetingRepository: Repository<MeetingEntity>,
    @InjectRepository(BookingEntity)
    private bookingRepository: Repository<BookingEntity>,
    private notificationAboutMeetingsService: NotificationAboutMeetingsService,
    private calenderService: CalendarService,
    private usersService: UsersService,
    private dataSource: DataSource)
  { }

  async create(username: string, updateMeetingDto: UpdateMeetingDto): Promise<MeetingEntity> {
    const meeting = this.meetingRepository.create(updateMeetingDto);
    meeting.username = username;
    meeting.tags = [];
    meeting.comments = [];
    meeting.images = [];
    return this.meetingRepository.save(meeting).then(m => this.notificationAboutMeetingsService.newMeeting(m));
  }

  findAll(filter: MeetingsFilter) {
    let options: FindOptionsWhere<MeetingEntity>[] = [{
      courseOrEvent: filter.courseOrEvent,
      isIdea: filter.idea,
      deleted: false
    }];

    if(filter.username) {
      options[0].username = filter.username;
    }    
    
    if(filter.tags && filter.tags.length > 0) {
      options[0].tags = ArrayContains(filter.tags);
    }

    if(filter.showNew && filter.showNotAnnounced && filter.showOld) {
      // filter has not to be set
    } else {
      var createDateConditions: FindOperator<Date>[] = [];
      if(filter.showNew) {
        createDateConditions.push(MoreThanOrEqual(new Date()));
      }

      if(filter.showOld) {
        createDateConditions.push(LessThan(new Date()));
      }

      if(filter.showNotAnnounced) {
        createDateConditions.push(IsNull());
      }

      createDateConditions.forEach((cond, index) => {
          if(options.length < index) {
            options.push({...options[0]});
          }
          options[index].startTime = cond;
      });
    }

    return this.meetingRepository.find({ where: options, relations: {
      comments: true
    }});
  }

  findOne(id: number){
    return this.meetingRepository.findOne({
      where:{mid: id, deleted: false},
      relations: {
        comments: true
      }
    });
  }

  async update(id: number, newMeeting: MeetingEntity): Promise<MeetingEntity> {
    const meeting = await this.meetingRepository.findOne({where: {mid: id}});
    const bookings = await this.getBookingsByMeetingID(id); //meeting.bookings doesnt work -> undefined
    if ((meeting.startTime != newMeeting.startTime) || (meeting.endTime != newMeeting.endTime)){
      const iCal = this.calenderService.createICAL(newMeeting);
      await this.notificationAboutMeetingsService.timeChanged(newMeeting, bookings, iCal);
    }
    if (meeting.location != newMeeting.location){
      await this.notificationAboutMeetingsService.locationChanged(newMeeting, bookings);
    }
    const updatedMeeting = this.setMeetingFields(meeting, newMeeting);
    return this.meetingRepository.save(updatedMeeting);
  }


  private setMeetingFields(oldMeeting: MeetingEntity, newMeeting: MeetingEntity): MeetingEntity{
    const updatedFields: Partial<MeetingEntity> = {};
    if (newMeeting.title != undefined){
      updatedFields.title = newMeeting.title;
    }
    if(newMeeting.shortDescription != undefined){
      updatedFields.shortDescription = newMeeting.shortDescription;
    }
    if (newMeeting.description != undefined){
      updatedFields.description = newMeeting.description;
    }
    if (newMeeting.startTime != undefined){
      updatedFields.startTime = newMeeting.startTime;
    }
    if(newMeeting.endTime != undefined){
      updatedFields.endTime = newMeeting.endTime;
    }
    if(newMeeting.location != undefined){
      updatedFields.location = newMeeting.location;
    }
    if(newMeeting.costCenter != undefined){
      updatedFields.costCenter = newMeeting.costCenter;
    }
    if(newMeeting.courseOrEvent != undefined){
      updatedFields.courseOrEvent = newMeeting.courseOrEvent;
    }
    if(newMeeting.isIdea != undefined){
      updatedFields.isIdea = newMeeting.isIdea;
    }
    if (newMeeting.isFreetime != undefined){
      updatedFields.isFreetime = newMeeting.isFreetime;
    }
    if(newMeeting.numberOfAllowedExternals != undefined){
      updatedFields.numberOfAllowedExternals = newMeeting.numberOfAllowedExternals;
    }
    if(newMeeting.tags != undefined){
      updatedFields.tags = newMeeting.tags;
    }
    Object.assign(oldMeeting, updatedFields);
    return oldMeeting;
  }

  updateByEntity(meetingEntity: MeetingEntity) {
    return this.meetingRepository.save(meetingEntity);
  }

  async delete(id: number) {
    const meeting = await this.meetingRepository.findOne({where: {mid: id}});
    meeting.deleted = true;
    const attendees = await this.getBookingsByMeetingID(id);
    return this.meetingRepository.save(meeting).then(m => this.notificationAboutMeetingsService.deletedMeeting(m, attendees));
  }

  async addComment(id: number, username: string, text: string): Promise<MeetingEntity>{
    const meeting = await this.meetingRepository.findOne({where: {mid: id}, relations: {comments: true}});
    if(!meeting){
      throw new HttpException('Meeting not found', HttpStatus.NOT_FOUND);
    }
    const user = await this.usersService.findOne(username);
    const comment = new CommentEntity();
    comment.text = text;
    comment.user = user;
    if(!meeting.comments){
      meeting.comments = [];
    }
    meeting.comments.push(comment);
    const attendees = await this.getBookingsByMeetingID(id);
    return this.meetingRepository.save(meeting).then(m => this.notificationAboutMeetingsService.newComment(m, comment, attendees));
  }

  async getBookingsByMeetingID(id: number): Promise<BookingEntity[]>{
    const meeting = await this.meetingRepository.findOne({where: {mid: id}});
    if (!meeting){
      throw new HttpException('Meeting not found', HttpStatus.NOT_FOUND);
    }
    return this.bookingRepository.save(await this.bookingRepository.find({ where: { mid: id }, relations: {user: true}}));
  }

  async addComment(id: number, data: CommentEntity): Promise<MeetingEntity>{
    const meeting = await this.meetingRepository.findOne({where: {mid: id}});
    console.log(meeting);
    if(!meeting){
      throw new HttpException('Meeting not found', HttpStatus.NOT_FOUND);
    }
    const comment = new CommentEntity;
    comment.text = data.text;
    comment.creationDate = data.creationDate;
    comment.author = data.author;
    if(!meeting.comments){
      meeting.comments = [];
    }
    meeting.comments.push(comment);
    return this.meetingRepository.save(meeting);
  }

  async getAttendeesByMeetingID(id: number): Promise<MeetingUserEntity[]>{
    const meeting = await this.meetingRepository.findOne({where: {mid: id}});
    if (!meeting){
      throw new HttpException('Meeting not found', HttpStatus.NOT_FOUND);
    }
    const attendees = await this.meetingUserRepository.find({where: {mid: id}});
    return attendees;
  }

  getAllTags(): Promise<string[]> {
    return this.dataSource.createQueryBuilder()
    .select("distinct UNNEST(meeting.tags)", 't')
    .from(MeetingEntity, "meeting")
    .where("meeting.tags <> '{}'")
    .getRawMany().then( result => result ? result.map(r => r.t): [])
  }
}
